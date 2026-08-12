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

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`provision-twenty-instance: --${name} is required`);
  return value;
}

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`provision-twenty-instance: ${name} is not set`);
  return value;
}

async function main(): Promise<void> {
  if (process.argv.includes("--activate")) {
    await activateTwentyConnection(arg("org-id"), arg("api-key-ref"), arg("tag"));
    console.log(`twenty: org ${arg("org-id")} is active`);
    return;
  }

  const orgSlug = arg("slug");
  const api = createCoolifyApi(env("COOLIFY_BASE_URL"), env("COOLIFY_API_TOKEN"));
  const result = await provisionTwentyInstance(api, {
    orgId: arg("org-id"),
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
  });

  const variable = `TWENTY_API_KEY_${orgSlug.replace(/-/g, "_").toUpperCase()}`;
  console.log(`twenty: service ${result.serviceUuid} deployed and healthy, state=provisioning

Manual steps (tenancy spec §9, steps 4-6):
  1. Open https://${orgSlug}.${env("TWENTY_DOMAIN_SUFFIX")} and complete first-run setup.
  2. Settings -> API keys: create a key scoped to person and opportunity access
     ONLY. A workspace-admin key is not needed and must not be issued.
  3. Put it in ${variable} in the secret store, then run:
     npx tsx --env-file=.env.local scripts/provision-twenty-instance.ts \\
       --activate --org-id ${arg("org-id")} --api-key-ref env://${variable} --tag ${process.env.TWENTY_TAG ?? "latest"}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("twenty provisioning failed", err);
    process.exit(1);
  });
