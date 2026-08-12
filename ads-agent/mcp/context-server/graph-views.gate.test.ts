// ads-agent/mcp/context-server/graph-views.gate.test.ts
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const LIVE =
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.AGENT_RO_DATABASE_URL) &&
  Boolean(process.env.CLICKHOUSE_URL);

const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const ownerPool = LIVE ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
const agentPool = LIVE ? new Pool({ connectionString: process.env.AGENT_RO_DATABASE_URL }) : null;

afterAll(async () => {
  await ownerPool?.end();
  await agentPool?.end();
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

  it("agent_ro can SELECT from v_agent_graph_node after tenant pin", async () => {
    const client = await agentPool!.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT public.set_tenant($1)", [ORG_A]);
      // agent_ro cannot LOAD 'pg_clickhouse'; SET session_settings works once the
      // extension is installed (same outcome db.ts needs before querying FDW views).
      await client.query(
        `SET pg_clickhouse.session_settings = $$SQL_current_tenant_id '${ORG_A}'$$`,
      );
      const { rows } = await client.query(
        "SELECT 1 AS ok FROM context.v_agent_graph_node LIMIT 1",
      );
      expect(rows.length).toBeLessThanOrEqual(1);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });
});
