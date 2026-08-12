import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";

const live = Boolean(process.env.TEST_DATABASE_URL);
let pool: Pool;
let orgId: string;

beforeAll(async () => {
  if (!live) return;
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
  orgId = (await pool.query<{ id: string }>("SELECT id::text AS id FROM public.orgs ORDER BY id LIMIT 1")).rows[0].id;
});

afterAll(async () => {
  if (live) await pool.end();
});

describe.skipIf(!live)("consent schema", () => {
  it("seeds exactly the three catalogue purposes", async () => {
    const { rows } = await pool.query<{ code: string }>("SELECT code FROM context.consent_purposes ORDER BY code");
    expect(rows.map((r) => r.code)).toEqual(["enquiry_handling", "site_analytics", "space_recommendation"]);
  });

  it("refuses a consent record naming a purpose outside the catalogue", async () => {
    await expect(
      pool.query(
        `INSERT INTO context.consent_records (org_id, subject_ref, purposes, action, notice_version, mechanism)
         VALUES ($1, 'sess-1', ARRAY['whatever_we_feel_like'], 'granted', 1, 'banner')`,
        [orgId],
      ),
    ).rejects.toThrow(/consent_records_purposes_in_catalogue|violates check constraint/);
  });

  it("is append-only: UPDATE and DELETE both raise", async () => {
    await pool.query(
      `INSERT INTO context.consent_records (org_id, subject_ref, purposes, action, notice_version, mechanism)
       VALUES ($1, 'sess-immutable', ARRAY['site_analytics'], 'granted', 1, 'banner')`,
      [orgId],
    );
    await expect(
      pool.query("UPDATE context.consent_records SET action = 'withdrawn' WHERE subject_ref = 'sess-immutable'"),
    ).rejects.toThrow("append-only");
    await expect(
      pool.query("DELETE FROM context.consent_records WHERE subject_ref = 'sess-immutable'"),
    ).rejects.toThrow("append-only");
  });

  it("emits consent_changed on insert, carrying org and subject", async () => {
    const listener = await pool.connect();
    const received: string[] = [];
    listener.on("notification", (msg) => { if (msg.payload) received.push(msg.payload); });
    await listener.query("LISTEN consent_changed");

    await pool.query(
      `INSERT INTO context.consent_records (org_id, subject_ref, purposes, action, notice_version, mechanism)
       VALUES ($1, 'sess-notify', ARRAY['space_recommendation'], 'granted', 1, 'banner')`,
      [orgId],
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    listener.release();

    expect(received).toContain(`${orgId}:sess-notify`);
  });

  it("forces row level security on every new context table", async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'context' AND c.relkind = 'r'
          AND c.relname IN ('tenant_portal_config','consent_records')
          AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)`,
    );
    expect(rows).toEqual([]);
  });

  it("gives every catalogue purpose a retention window", async () => {
    const { rows } = await pool.query<{ code: string }>(
      `SELECT p.code FROM context.consent_purposes p
         LEFT JOIN context.purpose_retention r ON r.purpose = p.code
        WHERE r.purpose IS NULL`,
    );
    expect(rows).toEqual([]);
  });
});
