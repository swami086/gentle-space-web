// ads-agent/mcp/context-server/fdw-tenant.gate.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const LIVE = Boolean(process.env.DATABASE_URL) && Boolean(process.env.CLICKHOUSE_URL);
const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SNAP = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const NODE_A = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const NODE_B = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

const pool = LIVE ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

async function chInsert(sql: string): Promise<void> {
  const base = (process.env.CLICKHOUSE_URL ?? "http://localhost:8123").replace(/\/+$/, "");
  const user = process.env.CLICKHOUSE_ETL_USER ?? "etl_writer";
  const password = process.env.CLICKHOUSE_ETL_PASSWORD ?? "etl";
  const auth = Buffer.from(`${user}:${password}`).toString("base64");
  const res = await fetch(`${base}/?`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}` },
    body: sql,
  });
  if (!res.ok) throw new Error(`clickhouse insert failed: ${res.status} ${await res.text()}`);
}

beforeAll(async () => {
  if (!LIVE) return;
  await chInsert(`
    INSERT INTO gentle_space.graph_node
      (org_id, snapshot_id, node_id, node_kind, label, subject_ref, props)
    VALUES
      ('${ORG_A}', '${SNAP}', '${NODE_A}', 'Space', 'A', NULL, '{}'),
      ('${ORG_B}', '${SNAP}', '${NODE_B}', 'Space', 'B', NULL, '{}')
  `);
});

afterAll(async () => {
  if (LIVE) {
    await chInsert(
      `ALTER TABLE gentle_space.graph_node DELETE WHERE snapshot_id = '${SNAP}'`,
    ).catch(() => {});
  }
  await pool?.end();
});

describe.skipIf(!LIVE)("pg_clickhouse FDW tenant gate (B5)", () => {
  it("extension pg_clickhouse is installed", async () => {
    const { rows } = await pool!.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'pg_clickhouse'`,
    );
    expect(rows).toHaveLength(1);
  });

  it("exposes the five context.fdw_* foreign tables", async () => {
    const { rows } = await pool!.query<{ n: string }>(
      `SELECT foreign_table_name AS n FROM information_schema.foreign_tables
        WHERE foreign_table_schema = 'context' AND foreign_table_name LIKE 'fdw_%'
        ORDER BY 1`,
    );
    expect(rows.map((r) => r.n)).toEqual([
      "fdw_enquiry_fact",
      "fdw_graph_edge",
      "fdw_graph_node",
      "fdw_portal_event_daily",
      "fdw_search_performed_daily",
    ]);
  });

  it("grants agent_ro no SELECT on any fdw_* table", async () => {
    const { rows } = await pool!.query(
      `SELECT table_name FROM information_schema.role_table_grants
        WHERE grantee = 'agent_ro' AND table_name LIKE 'fdw_%'`,
    );
    expect(rows).toEqual([]);
  });

  it("isolates tenants via pg_clickhouse.session_settings SQL_current_tenant_id", async () => {
    const client = await pool!.connect();
    try {
      await client.query(`LOAD 'pg_clickhouse'`);
      await client.query(
        `SET pg_clickhouse.session_settings = $$SQL_current_tenant_id '${ORG_A}'$$`,
      );
      const { rows: a } = await client.query<{ node_id: string }>(
        `SELECT node_id::text FROM context.fdw_graph_node WHERE snapshot_id = $1`,
        [SNAP],
      );
      expect(a.map((r) => r.node_id)).toEqual([NODE_A]);

      await client.query(
        `SET pg_clickhouse.session_settings = $$SQL_current_tenant_id '${ORG_B}'$$`,
      );
      const { rows: b } = await client.query<{ node_id: string }>(
        `SELECT node_id::text FROM context.fdw_graph_node WHERE snapshot_id = $1`,
        [SNAP],
      );
      expect(b.map((r) => r.node_id)).toEqual([NODE_B]);
    } finally {
      client.release();
    }
  });
});
