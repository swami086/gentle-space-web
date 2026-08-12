import type { Pool, PoolClient } from "pg";
import { getPool } from "./client";
import type { Scope } from "./scope";

/**
 * One transaction for the domain write and its outbox event. set_config's third
 * argument is transaction-scoped, so the tenant must be set inside the
 * transaction that carries the write, or the next request on the same pooled
 * connection inherits it.
 */
export async function withTenantTransaction<T>(
  scope: Scope,
  fn: (client: PoolClient) => Promise<T>,
  pool: Pool = getPool(),
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (scope.kind === "org") {
      await client.query("SELECT public.set_tenant($1)", [scope.orgId]);
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
