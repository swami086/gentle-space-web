import type { PoolClient } from "pg";
import { getPool } from "./client";

/**
 * The listings app's equivalent of ads-agent/lib/db/tx.ts. Separate file
 * because the two apps have separate module graphs; identical semantics,
 * because FORCE ROW LEVEL SECURITY does not care which app is connecting.
 * set_tenant is transaction-scoped, so a pooled connection cannot carry the
 * tenant into the next request.
 */
export async function withTenantTransaction<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!orgId) throw new Error("withTenantTransaction: orgId is required");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT public.set_tenant($1)", [orgId]);
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
