import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
let pool: Pool;

beforeAll(() => {
  if (url) pool = new Pool({ connectionString: url, max: 2 });
});
afterAll(async () => {
  if (pool) await pool.end();
});

suite("consolidated schema layout", () => {
  it("has all five schemas", async () => {
    const { rows } = await pool.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace
        WHERE nspname IN ('listings','adsagent','context','public','derived')
        ORDER BY nspname`,
    );
    expect(rows.map((r) => r.nspname)).toEqual([
      "adsagent",
      "context",
      "derived",
      "listings",
      "public",
    ]);
  });

  it("has all six roles", async () => {
    const { rows } = await pool.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles
        WHERE rolname IN ('listings_rw','adsagent_rw','context_rw','shared_rw','derived_rw','agent_ro')
        ORDER BY rolname`,
    );
    expect(rows.map((r) => r.rolname)).toEqual([
      "adsagent_rw",
      "agent_ro",
      "context_rw",
      "derived_rw",
      "listings_rw",
      "shared_rw",
    ]);
  });

  it("grants no role BYPASSRLS or SUPERUSER", async () => {
    const { rows } = await pool.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles
        WHERE rolname IN ('listings_rw','adsagent_rw','context_rw','shared_rw','derived_rw','agent_ro')
          AND (rolbypassrls OR rolsuper)`,
    );
    expect(rows).toEqual([]);
  });

  it("gives agent_ro no write privilege anywhere", async () => {
    const { rows } = await pool.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'agent_ro' AND privilege_type <> 'SELECT'`,
    );
    expect(rows).toEqual([]);
  });

  it("puts the four listings tables in the listings schema", async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'listings' AND c.relkind = 'r' ORDER BY c.relname`,
    );
    expect(rows.map((r) => r.relname)).toEqual([
      "listing_enrichment_log",
      "listings",
      "search_queries",
      "sync_runs",
    ]);
  });

  it("leads every application role's search_path with ag_catalog", async () => {
    const { rows } = await pool.query<{ rolname: string; rolconfig: string[] | null }>(
      `SELECT rolname, rolconfig FROM pg_roles
        WHERE rolname IN ('listings_rw','adsagent_rw','context_rw','shared_rw','derived_rw','agent_ro')`,
    );
    for (const row of rows) {
      const sp = (row.rolconfig ?? []).find((c) => c.startsWith("search_path="));
      expect(sp, `${row.rolname} has no search_path`).toBeDefined();
      expect(sp!.replace("search_path=", "").trim()).toMatch(/^ag_catalog\b/);
    }
  });

  it("holds the twelve ads-agent domain tables in adsagent", async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'adsagent' AND c.relkind = 'r' ORDER BY c.relname`,
    );
    expect(rows.map((r) => r.relname)).toEqual([
      "ai_action_log",
      "campaign_draft_messages",
      "campaign_drafts",
      "campaigns",
      "credit_grants",
      "crm_signal_snapshots",
      "cron_settings",
      "org_balances",
      "performance_snapshots",
      "proposals",
      "usage_ledger",
      "user_balances",
    ]);
  });

  it("keeps orgs and users in public", async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN ('orgs','users')
        ORDER BY c.relname`,
    );
    expect(rows.map((r) => r.relname)).toEqual(["orgs", "users"]);
  });
});
