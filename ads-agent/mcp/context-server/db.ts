import { Pool, type PoolClient } from "pg";

let agentPool: Pool | null = null;

/**
 * Connection pool for the MCP context server. Connects as `agent_ro` — a
 * read-only, non-owner role holding SELECT on tenant-scoped views only. This is
 * what makes FORCE ROW LEVEL SECURITY meaningful: a connection as the table
 * owner would set the tenant variable correctly and enforce nothing
 * (agent spec §5, validation report F-20).
 *
 * There is deliberately no fallback to DATABASE_URL. That variable holds the
 * owner connection, and silently falling back to it would void row security
 * without any error to notice.
 */
export function getAgentReadPool(): Pool {
  const url = process.env.AGENT_RO_DATABASE_URL;
  if (!url) throw new Error("AGENT_RO_DATABASE_URL is not set");
  if (!agentPool) agentPool = new Pool({ connectionString: url, max: 4 });
  return agentPool;
}

export async function closeAgentReadPool(): Promise<void> {
  if (!agentPool) return;
  await agentPool.end();
  agentPool = null;
}

export type TenantTx = { query: PoolClient["query"] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertOrgIdUuid(orgId: string): void {
  if (!UUID_RE.test(orgId)) throw new Error("invalid orgId");
}

async function pinClickHouseTenant(client: PoolClient, orgId: string): Promise<void> {
  assertOrgIdUuid(orgId);
  await client.query("LOAD 'pg_clickhouse'");
  await client.query(`SET pg_clickhouse.session_settings = $$SQL_current_tenant_id '${orgId}'$$`);
}

async function inTransaction<T>(
  orgId: string,
  readWrite: boolean,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  const client = await getAgentReadPool().connect();
  try {
    await client.query("BEGIN");
    if (readWrite) await client.query("SET TRANSACTION READ WRITE");
    // public.set_tenant passes `true` as set_config's third argument, so the
    // setting is transaction-local. Both apps use pg.Pool; without that the
    // setting persists on the connection and the next call inherits this tenant.
    await client.query("SELECT public.set_tenant($1)", [orgId]);
    await pinClickHouseTenant(client, orgId);
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

/** Every read tool runs inside this. Read-only, tenant pinned for the transaction. */
export function withAgentTenantTx<T>(orgId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return inTransaction(orgId, false, fn);
}

/**
 * The only read-write path. `agent_ro` has no INSERT/UPDATE/DELETE grant on any
 * table, so this is useful solely for calling the two SECURITY DEFINER functions
 * it may execute: adsagent.agent_create_proposal and
 * context.record_agent_token_usage. Opting into read-write is explicit and
 * greppable on purpose.
 */
export function withAgentTenantWriteTx<T>(
  orgId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return inTransaction(orgId, true, fn);
}
