import { Pool } from "pg";

let pool: Pool | null = null;
const roleChecks = new WeakMap<Pool, Promise<void>>();

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
 * Checks the supplied pool's role — relay workers pass relayPool(), not getPool().
 */
export async function assertDbRole(target: Pool): Promise<void> {
  if (process.env.SKIP_DB_ROLE_CHECK === "1") return;
  let check = roleChecks.get(target);
  if (!check) {
    check = (async () => {
      const client = await target.connect();
      try {
        const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
          `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
        );
        const row = rows[0];
        if (row?.rolsuper || row?.rolbypassrls) {
          throw new Error(
            "Database URL must not use a superuser or BYPASSRLS role — tenant RLS is bypassed.",
          );
        }
      } finally {
        client.release();
      }
    })();
    roleChecks.set(target, check);
  }
  await check;
}

/** @deprecated Prefer assertDbRole(getPool()) at call sites that know their pool. */
export async function assertApplicationDbRole(): Promise<void> {
  await assertDbRole(getPool());
}
