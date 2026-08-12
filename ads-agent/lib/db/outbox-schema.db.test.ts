import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, testPool } from "./test-support";

const pool = testPool();

afterAll(async () => {
  await closeTestPool();
});

describe("context.outbox_events", () => {
  it("lives in the context schema with the columns from data model 5a", async () => {
    const { rows } = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'context' AND table_name = 'outbox_events'
        ORDER BY column_name`,
    );
    expect(rows).toEqual([
      { column_name: "attempts", data_type: "integer", is_nullable: "NO" },
      { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "id", data_type: "uuid", is_nullable: "NO" },
      { column_name: "last_error", data_type: "text", is_nullable: "YES" },
      { column_name: "ordering_key", data_type: "text", is_nullable: "NO" },
      { column_name: "org_id", data_type: "uuid", is_nullable: "NO" },
      { column_name: "payload", data_type: "jsonb", is_nullable: "NO" },
      { column_name: "published_at", data_type: "timestamp with time zone", is_nullable: "YES" },
      { column_name: "topic", data_type: "text", is_nullable: "NO" },
    ]);
  });

  it("defaults id to uuidv7 so the relay reads in insertion order", async () => {
    const { rows } = await pool.query<{ column_default: string }>(
      `SELECT column_default FROM information_schema.columns
        WHERE table_schema = 'context' AND table_name = 'outbox_events' AND column_name = 'id'`,
    );
    expect(rows[0].column_default).toContain("uuidv7()");
  });

  it("has row level security enabled AND forced", async () => {
    const { rows } = await pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'context' AND c.relname = 'outbox_events'`,
    );
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("carries a tenant policy with both USING and WITH CHECK", async () => {
    const { rows } = await pool.query<{ polname: string; qual: string | null; withcheck: string | null }>(
      `SELECT pol.polname,
              pg_get_expr(pol.polqual, pol.polrelid)      AS qual,
              pg_get_expr(pol.polwithcheck, pol.polrelid) AS withcheck
         FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'context' AND c.relname = 'outbox_events' AND pol.polname = 'tenant_isolation'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].qual).toContain("current_tenant()");
    expect(rows[0].withcheck).toContain("current_tenant()");
  });

  it("has the relay's partial index and a tenant-leading index", async () => {
    const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'context' AND tablename = 'outbox_events' ORDER BY indexname`,
    );
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    expect(byName.get("outbox_events_unpublished_idx")).toContain("WHERE (published_at IS NULL)");
    expect(byName.get("outbox_events_org_created_idx")).toContain("(org_id, created_at)");
  });

  it("rejects a topic outside the published vocabulary", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const slug = `topic-check-${suffix}`.toLowerCase();
    const orgId = await pool
      .query<{ id: string }>(
        `INSERT INTO public.orgs (name, kind, slug) VALUES ($1, 'external', $2) RETURNING id`,
        [`topic-check-${suffix}`, slug],
      )
      .then((r) => r.rows[0].id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT public.set_tenant($1)", [orgId]);
      await expect(
        client.query(
          `INSERT INTO context.outbox_events (org_id, topic, payload, ordering_key)
           VALUES ($1, 'enquiry.invented', '{}'::jsonb, $2)`,
          [orgId, orgId],
        ),
      ).rejects.toThrow(/outbox_events_topic_check/);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
