import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import type { PlanInput } from "./twenty-provisioning";

/** Safe identifier: org slug already validated by SLUG in buildTwentyServicePlan. */
function tenantDbNames(orgSlug: string): { user: string; database: string } {
  const underscored = orgSlug.replace(/-/g, "_");
  return { user: `twenty_${underscored}`, database: `twenty_${underscored}` };
}

function adminUrl(): string {
  const url = process.env.TWENTY_PG_ADMIN_URL?.trim();
  if (url) return url;
  throw new Error(
    "twenty postgres: set TWENTY_PG_ADMIN_URL (superuser URL reachable from this machine), or TWENTY_PG_ENSURE_SSH + TWENTY_PG_ENSURE_CONTAINER to run DDL on the Coolify host",
  );
}

/** Run tenant DDL inside the Coolify Postgres container when it is not reachable from this machine. */
async function ensureTenantPostgresViaSsh(
  input: Pick<PlanInput, "orgSlug" | "postgresPassword">,
): Promise<void> {
  const ssh = process.env.TWENTY_PG_ENSURE_SSH!.trim();
  const container = process.env.TWENTY_PG_ENSURE_CONTAINER!.trim();
  const pgUser = process.env.TWENTY_PG_ENSURE_USER?.trim() || "gentle";
  const { user, database } = tenantDbNames(input.orgSlug);
  const pass = input.postgresPassword.replace(/'/g, "''");
  const script = `
set -e
docker exec ${container} psql -U ${pgUser} -d postgres -v ON_ERROR_STOP=1 -c "DO \\$\\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${user}') THEN CREATE ROLE ${user} LOGIN PASSWORD '${pass}'; ELSE ALTER ROLE ${user} PASSWORD '${pass}'; END IF; END \\$\\$;"
if ! docker exec ${container} psql -U ${pgUser} -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${database}'" | grep -q 1; then
  docker exec ${container} psql -U ${pgUser} -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${database} OWNER ${user}"
fi
docker exec ${container} psql -U ${pgUser} -d postgres -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE ${database} TO ${user}"
`.trim();
  execFileSync("ssh", ["-o", "BatchMode=yes", ssh, script], { stdio: "inherit" });
}

/**
 * §9 step 3: each tenant gets its own Postgres role + database on the shared
 * server. Without this, Twenty exits immediately and Coolify health never passes.
 */
export async function ensureTenantPostgres(input: Pick<PlanInput, "orgSlug" | "postgresPassword">): Promise<void> {
  if (process.env.TWENTY_PG_ENSURE_SSH?.trim() && process.env.TWENTY_PG_ENSURE_CONTAINER?.trim()) {
    await ensureTenantPostgresViaSsh(input);
    return;
  }
  const { user, database } = tenantDbNames(input.orgSlug);
  const pool = new Pool({ connectionString: adminUrl() });
  const client = await pool.connect();
  try {
    const exists = await client.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS ok`,
      [user],
    );
    if (!exists.rows[0]?.ok) {
      const pass = input.postgresPassword.replace(/'/g, "''");
      await client.query(`CREATE ROLE ${user} LOGIN PASSWORD '${pass}'`);
    } else {
      const pass = input.postgresPassword.replace(/'/g, "''");
      await client.query(`ALTER ROLE ${user} PASSWORD '${pass}'`);
    }

    const dbExists = await client.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS ok`,
      [database],
    );
    if (!dbExists.rows[0]?.ok) {
      await client.query(`CREATE DATABASE ${database} OWNER ${user}`);
    }
    await client.query(`GRANT ALL PRIVILEGES ON DATABASE ${database} TO ${user}`);
  } finally {
    client.release();
    await pool.end();
  }
}
