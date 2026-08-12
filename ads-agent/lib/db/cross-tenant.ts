import type { PoolClient } from "pg";
import { getPool } from "./client";

/**
 * The one way to read across tenants. Sets app.cross_tenant transaction-scoped
 * (third set_config argument) so it cannot leak onto the pooled connection,
 * and writes the audit row the observability alert watches for — any
 * cross-tenant row not attributable to a scheduled job is the isolation
 * boundary being crossed (datastore §12.4).
 *
 * The matching RLS policies are FOR SELECT only, so this session can read
 * every org and write none of them.
 */
export async function withCrossTenantRead<T>(
  actorRef: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.cross_tenant', 'projector', true)");
    await client.query(
      `INSERT INTO context.access_log (org_id, actor_kind, actor_ref, action)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, $2, $3)`,
      ["cross_tenant", actorRef, "cross_tenant.read"],
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
