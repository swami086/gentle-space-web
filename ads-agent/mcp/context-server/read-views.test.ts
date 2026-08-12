import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const LIVE = Boolean(process.env.DATABASE_URL);
const pool = LIVE ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

afterAll(async () => {
  await pool?.end();
});

const VIEWS = [
  "v_agent_enquiries",
  "v_agent_enquiry_activity",
  "v_agent_spaces",
  "v_agent_proposals",
  "v_agent_campaigns",
  "v_agent_graph_node",
  "v_agent_graph_edge",
] as const;

// FDW graph views use definer security — agent_ro has no SELECT on fdw_graph_*.
const DEFINER_VIEWS = new Set(["v_agent_graph_node", "v_agent_graph_edge"]);

// listings.* has no RLS — spaces uses SECURITY DEFINER; never grant those tables.
const ALLOWED_BASE_TABLES = new Set([
  "adsagent.enquiries",
  "adsagent.enquiry_activities",
  "adsagent.proposals",
  "adsagent.campaigns",
]);

describe.skipIf(!LIVE)("agent read views", () => {
  it.each(VIEWS)("context.%s exists", async (view) => {
    const { rows } = await pool!.query(
      `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'context' AND c.relname = $1 AND c.relkind = 'v'`,
      [view],
    );
    expect(rows).toHaveLength(1);
  });

  it("RLS-backed agent views set security_invoker; FDW graph views use definer security", async () => {
    const { rows } = await pool!.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'context' AND c.relname LIKE 'v_agent_%' AND c.relkind = 'v'
          AND NOT COALESCE(array_to_string(c.reloptions, ',') LIKE '%security_invoker=true%', false)`,
    );
    expect(rows.map((r) => r.relname).sort()).toEqual([...DEFINER_VIEWS].sort());
  });

  it("every agent view embeds the tenant predicate in its own definition", async () => {
    const { rows } = await pool!.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'context' AND c.relname LIKE 'v_agent_%' AND c.relkind = 'v'
          AND pg_get_viewdef(c.oid) NOT LIKE '%current_tenant()%'`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("grants agent_ro SELECT only on context views and allowlisted base tables", async () => {
    const { rows } = await pool!.query<{
      table_schema: string;
      table_name: string;
      privilege_type: string;
    }>(
      `SELECT table_schema, table_name, privilege_type
         FROM information_schema.role_table_grants
        WHERE grantee = 'agent_ro'`,
    );
    expect(rows.length).toBeGreaterThan(0);

    const viewGrants = new Set<string>();
    for (const row of rows) {
      expect(row.privilege_type).toBe("SELECT");
      const qualified = `${row.table_schema}.${row.table_name}`;
      if (row.table_schema === "context" && row.table_name.startsWith("v_agent_")) {
        viewGrants.add(row.table_name);
        continue;
      }
      expect(ALLOWED_BASE_TABLES.has(qualified)).toBe(true);
    }
    for (const view of VIEWS) {
      expect(viewGrants.has(view)).toBe(true);
    }
  });
});
