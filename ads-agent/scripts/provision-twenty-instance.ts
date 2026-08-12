/**
 * Provisions one org's Twenty instance. Per tenancy spec §9 step 5, generating
 * the API key is manual — Twenty exposes no endpoint for it — so this script
 * stops at state 'provisioning' and prints what to do next.
 *
 *   npx tsx --env-file=.env.local scripts/provision-twenty-instance.ts \
 *     --org-id <uuid> --slug acme-realty
 */
import {
  activateTwentyConnection,
  createCoolifyApi,
  provisionTwentyInstance,
} from "../lib/crm/twenty-provisioning";
import { provisionTwentyLocal } from "../lib/crm/twenty-provision-local";
import { requireOrgSlug } from "../lib/db/orgs";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireArg(name: string): string {
  const value = arg(name);
  if (!value) throw new Error(`provision-twenty-instance: --${name} is required`);
  return value;
}

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
  if (!value) throw new Error(`provision-twenty-instance: ${name} is not set`);
  return value;
}

async function main(): Promise<void> {
  if (process.argv.includes("--activate")) {
    await activateTwentyConnection(requireArg("org-id"), requireArg("api-key-ref"), requireArg("tag"));
    console.log(`twenty: org ${requireArg("org-id")} is active`);
    return;
  }

  const orgId = requireArg("org-id");
  const orgSlug = arg("slug") ?? (await requireOrgSlug(orgId));

  if (process.argv.includes("--local")) {
    const postgresPassword = process.env.TWENTY_PG_PASSWORD?.trim();
    if (!postgresPassword) throw new Error("provision-twenty-instance: TWENTY_PG_PASSWORD is not set");
    const result = await provisionTwentyLocal({
      orgId,
      orgSlug,
      postgresPassword,
      twentyTag: process.env.TWENTY_TAG,
    });
    const keyRef = process.env.LOCAL_TWENTY_USE_SHARED_KEY === "1"
      ? "env://TWENTY_API_KEY"
      : `env://TWENTY_API_KEY_${orgSlug.replace(/-/g, "_").toUpperCase()}`;
    console.log(`twenty local: tenant DB ready, registry state=provisioning
  base_url=${result.baseUrl}
  Tenant DB: twenty_${orgSlug.replace(/-/g, "_")} on gentle-space-pg (TWENTY_PG_ADMIN_URL)

  Activate when TWENTY_API_KEY is set:
    npx tsx --env-file=.env.local scripts/provision-twenty-instance.ts \\
      --local --activate --org-id ${orgId} --api-key-ref ${keyRef} --tag ${process.env.TWENTY_TAG ?? "latest"}`);
    return;
  }

  const noWait = process.argv.includes("--no-wait");
  const api = createCoolifyApi(env("COOLIFY_BASE_URL"), env("COOLIFY_API_TOKEN"));
  const result = await provisionTwentyInstance(
    api,
    {
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
  },
    { waitForHealth: !noWait },
  );

  const variable = `TWENTY_API_KEY_${orgSlug.replace(/-/g, "_").toUpperCase()}`;
  console.log(`twenty: service ${result.serviceUuid} deployed and healthy, state=provisioning

Manual steps (tenancy spec §9, steps 4-6):
  1. Open https://${orgSlug}.${env("TWENTY_DOMAIN_SUFFIX")} and complete first-run setup.
  2. Settings -> API keys: create a key scoped to person and opportunity access
     ONLY. A workspace-admin key is not needed and must not be issued.
  3. Put it in ${variable} in the secret store, then run:
     npx tsx --env-file=.env.local scripts/provision-twenty-instance.ts \\
       --activate --org-id ${orgId} --api-key-ref env://${variable} --tag ${process.env.TWENTY_TAG ?? "latest"}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("twenty provisioning failed", err);
    process.exit(1);
  });
