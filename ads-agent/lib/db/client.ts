import { Pool } from "pg";

let pool: Pool | null = null;
let roleCheck: Promise<void> | null = null;

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

/**
 * Superuser and BYPASSRLS connections ignore FORCE RLS. Fail closed in every
 * environment except tests (SKIP_DB_ROLE_CHECK=1) and local bootstrap (migrate).
 */
export async function assertApplicationDbRole(): Promise<void> {
  if (process.env.SKIP_DB_ROLE_CHECK === "1") return;
  if (!roleCheck) {
    roleCheck = (async () => {
      const client = await getPool().connect();
      try {
        const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
          `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
        );
        const row = rows[0];
        if (row?.rolsuper || row?.rolbypassrls) {
          throw new Error(
            "DATABASE_URL must not use a superuser or BYPASSRLS role — tenant RLS is bypassed. Use adsagent_rw.",
          );
        }
      } finally {
        client.release();
      }
    })();
  }
  await roleCheck;
}
