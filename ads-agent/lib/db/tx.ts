import type { Pool, PoolClient } from "pg";
import { assertDbRole, getPool } from "./client";
import type { Scope } from "./scope-sql";

/**
 * Runs fn inside one transaction whose tenant context is set with the
 * transaction-local form of set_config.
 *
 * The optional third parameter takes the connection from a caller-supplied pool
 * instead of the app pool. S5a's outbox relay and S6a's reconciliation jobs run
 * against OUTBOX_RELAY_DATABASE_URL and need this same transaction logic without
 * a second copy of it.
 *
 * Both apps construct pg.Pool, so connections are reused between requests. A
 * connection-scoped setting would persist past COMMIT and the next request on
 * that connection would inherit this tenant -- RLS then faithfully enforces the
 * wrong tenant, with no error and no log line (validation F-1). See
 * tx.pooled.test.ts, which includes the leaking control case.
 *
 * ponytail: one transaction per data-layer call. Ceiling: a route calling three
 * data-layer functions opens three transactions and gets no cross-call
 * atomicity. Upgrade path: give each data-layer function an optional
 * `client?: PoolClient` last parameter and have the route open one withTenantTransaction
 * around them.
 */
export async function withTenantTransaction<T>(
  scope: Scope,
  fn: (client: PoolClient) => Promise<T>,
  pool?: Pool,
): Promise<T> {
  const targetPool = pool ?? getPool();
  await assertDbRole(targetPool);
  const client = await targetPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT public.set_tenant($1)", [scope.orgId]);
    if (scope.kind === "platform") {
      await client.query("SELECT public.set_platform()");
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      // A rollback failure means the connection is already unusable; the
      // original error is the one worth reporting.
    });
    throw err;
  } finally {
    client.release();
  }
}
