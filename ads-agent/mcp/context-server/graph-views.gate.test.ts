// ads-agent/mcp/context-server/graph-views.gate.test.ts
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { closeAgentReadPool, withAgentTenantTx } from "./db";

const LIVE =
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.AGENT_RO_DATABASE_URL) &&
  Boolean(process.env.CLICKHOUSE_URL);

const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const ownerPool = LIVE ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

afterAll(async () => {
  await ownerPool?.end();
  await closeAgentReadPool();
});

describe.skipIf(!LIVE)("agent_ro graph views gate", () => {
  it("grants agent_ro no SELECT on fdw_graph_* tables", async () => {
    const { rows } = await ownerPool!.query(
      `SELECT table_name FROM information_schema.role_table_grants
        WHERE grantee = 'agent_ro'
          AND table_schema = 'context'
          AND table_name LIKE 'fdw_graph_%'`,
    );
    expect(rows).toEqual([]);
  });

  it("graph views use definer security (not security_invoker)", async () => {
    const { rows } = await ownerPool!.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'context'
          AND c.relname IN ('v_agent_graph_node', 'v_agent_graph_edge')
          AND c.relkind = 'v'
          AND COALESCE(array_to_string(c.reloptions, ',') LIKE '%security_invoker=true%', false)`,
    );
    expect(rows).toEqual([]);
  });

  it("agent_ro can SELECT from v_agent_graph_node via withAgentTenantTx", async () => {
    const { rows } = await withAgentTenantTx(ORG_A, (tx) =>
      tx.query("SELECT 1 AS ok FROM context.v_agent_graph_node LIMIT 1"),
    );
    expect(rows.length).toBeLessThanOrEqual(1);
  });
});
