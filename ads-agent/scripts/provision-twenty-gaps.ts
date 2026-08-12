/**
 * Provisions every org that fails check-twenty-coverage. Resolves --slug from
 * public.orgs.slug so Step 7 of Task 11 is one command, not three manual UUID lookups.
 *
 *   npx tsx --env-file=.env.local scripts/provision-twenty-gaps.ts
 *   npx tsx --env-file=.env.local scripts/provision-twenty-gaps.ts --dry-run
 */
import { requireOrgSlug } from "../lib/db/orgs";
import { orgsWithoutOwnInstance } from "../lib/db/twenty-connections";
import { activateTwentyConnection } from "../lib/crm/twenty-provisioning";
import { provisionTwentyLocal } from "../lib/crm/twenty-provision-local";
import { createCoolifyApi, provisionTwentyInstance } from "../lib/crm/twenty-provisioning";

function env(name: string): string {
  const aliases: Record<string, string[]> = {
    COOLIFY_API_TOKEN: ["COOLIFY_ACCESS_TOKEN"],
  };
  let value = process.env[name]?.trim();
  if (!value && aliases[name]) {
    for (const alt of aliases[name]) {
      value = process.env[alt]?.trim();
      if (value) break;
    }
  }
  if (!value) throw new Error(`provision-twenty-gaps: ${name} is not set`);
  return value;
}

function planInput(orgId: string, orgSlug: string) {
  return {
    orgId,
    orgSlug,
    projectUuid: env("COOLIFY_PROJECT_UUID"),
    serverUuid: env("COOLIFY_SERVER_UUID"),
    environmentName: process.env.COOLIFY_ENVIRONMENT ?? "production",
    domainSuffix: env("TWENTY_DOMAIN_SUFFIX"),
    postgresHost: env("TWENTY_PG_HOST"),
    postgresPassword: env("TWENTY_PG_PASSWORD"),
    appSecret: env("TWENTY_APP_SECRET"),
    encryptionKey: env("TWENTY_ENCRYPTION_KEY"),
    twentyTag: process.env.TWENTY_TAG ?? "latest",
  };
}

async function main(): Promise<void> {
  const shared = env("SHARED_TWENTY_BASE_URL");
  const dryRun = process.argv.includes("--dry-run");
  const local = process.argv.includes("--local");
  const activate = process.argv.includes("--activate");
  const noWait = process.argv.includes("--no-wait");
  const gaps = await orgsWithoutOwnInstance(shared);

  if (gaps.length === 0) {
    console.log("twenty gaps: none — every org has its own active instance");
    return;
  }

  console.log(`twenty gaps: ${gaps.length} org(s) need provisioning${local ? " (local docker)" : ""}`);
  const api = local ? null : createCoolifyApi(env("COOLIFY_BASE_URL"), env("COOLIFY_API_TOKEN"));
  const postgresPassword = process.env.TWENTY_PG_PASSWORD?.trim();
  if (local && !postgresPassword) {
    throw new Error("provision-twenty-gaps: TWENTY_PG_PASSWORD is not set");
  }

  for (const gap of gaps) {
    const slug = gap.slug ?? (await requireOrgSlug(gap.orgId));
    console.log(`\n--- ${gap.orgId} (${slug}): ${gap.reason} ---`);
    if (dryRun) {
      console.log(`would provision slug=${slug}${local ? " locally" : ""}`);
      continue;
    }
    if (!local && gap.reason.startsWith("state=provisioning")) {
      console.log("already provisioning — complete manual API key steps, then --activate");
      continue;
    }

    if (local) {
      const result = await provisionTwentyLocal({
        orgId: gap.orgId,
        orgSlug: slug,
        postgresPassword,
        twentyTag: process.env.TWENTY_TAG,
      });
      console.log(`twenty local: ${result.baseUrl} state=provisioning`);
      if (activate && process.env.TWENTY_API_KEY?.trim()) {
        await activateTwentyConnection(
          gap.orgId,
          process.env.LOCAL_TWENTY_USE_SHARED_KEY === "1"
            ? "env://TWENTY_API_KEY"
            : `env://TWENTY_API_KEY_${slug.replace(/-/g, "_").toUpperCase()}`,
          process.env.TWENTY_TAG ?? "latest",
        );
        console.log(`twenty local: activated ${slug}`);
      }
      continue;
    }

    const result = await provisionTwentyInstance(api!, planInput(gap.orgId, slug), {
      waitForHealth: !noWait,
    });
    const variable = `TWENTY_API_KEY_${slug.replace(/-/g, "_").toUpperCase()}`;
    console.log(`twenty: service ${result.serviceUuid} deployed, state=provisioning
  Activate after API key:
    npx tsx --env-file=.env.local scripts/provision-twenty-instance.ts \\
      --activate --org-id ${gap.orgId} --api-key-ref env://${variable} --tag ${process.env.TWENTY_TAG ?? "latest"}`);
  }
}

main().catch((err) => {
  console.error("provision-twenty-gaps failed", err);
  process.exit(1);
});
