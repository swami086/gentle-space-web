import { randomBytes } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { chQuery } from "../../../lib/clickhouse/client";

const live = Boolean(process.env.TEST_DATABASE_URL && process.env.CLICKHOUSE_URL);

let pool: Pool;
let orgId: string;
let ingestKey: string;
let sessionId: string;

beforeAll(async () => {
  if (!live) return;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.CONSENT_CACHE_TTL_MS = "60000";
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 5 });
  orgId = (await pool.query<{ id: string }>("SELECT id::text AS id FROM public.orgs ORDER BY id LIMIT 1")).rows[0].id;
  ingestKey = "pk_s6a_gate_integration";
  sessionId = `s6agate${randomBytes(9).toString("base64url")}`;
  await pool.query(
    `INSERT INTO context.tenant_portal_config
       (org_id, ingest_key, allowed_origins, purposes_offered, notice_version)
     VALUES ($1, $2, ARRAY['https://broker.test'], ARRAY['space_recommendation'], 1)
     ON CONFLICT (org_id) DO UPDATE
       SET ingest_key = EXCLUDED.ingest_key, allowed_origins = EXCLUDED.allowed_origins,
           purposes_offered = EXCLUDED.purposes_offered`,
    [orgId, ingestKey],
  );
});

afterAll(async () => {
  if (!live) return;
  delete process.env.CONSENT_CACHE_TTL_MS;
  await pool.end();
});

beforeEach(async () => {
  if (!live) return;
  await pool.query(
    `INSERT INTO context.tenant_portal_config
       (org_id, ingest_key, allowed_origins, purposes_offered, notice_version)
     VALUES ($1, $2, ARRAY['https://broker.test'], ARRAY['space_recommendation'], 1)
     ON CONFLICT (org_id) DO UPDATE
       SET ingest_key = EXCLUDED.ingest_key,
           allowed_origins = EXCLUDED.allowed_origins,
           purposes_offered = EXCLUDED.purposes_offered`,
    [orgId, ingestKey],
  );
  const { clearPortalConfigCache } = await import("./config");
  clearPortalConfigCache();
  const { resetRateLimits } = await import("./rate-limit");
  resetRateLimits();
});

function ingestRequest(): Request {
  return new Request("https://ads.test/api/v1/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://broker.test", "X-Ingest-Key": ingestKey },
    body: JSON.stringify({
      taxonomy_version: 1,
      session_id: sessionId,
      events: [{ event: "listing_view", occurred_at: new Date().toISOString(), payload: { listing_ref: "gate-1", dwell_seconds: 3 } }],
    }),
  });
}

describe.skipIf(!live)("S6a gate", () => {
  it("an event from a broker's site reaches ClickHouse", async () => {
    const { recordConsent } = await import("./consent");
    const { POST } = await import("../../app/api/v1/ingest/route");
    const { chExec } = await import("../../../lib/clickhouse/client");

    await recordConsent({ kind: "org", orgId } as const, {
      subjectRef: sessionId, purposes: ["space_recommendation"], action: "granted",
      noticeVersion: 1, mechanism: "banner",
    });

    const res = await POST(ingestRequest());
    expect(res.status).toBe(202);

    const { rows } = await pool.query<{ payload: string }>(
      `SELECT payload::text AS payload FROM context.outbox_events
        WHERE topic = 'portal.event' AND payload->>'session_id' = $1
        ORDER BY created_at DESC LIMIT 1`,
      [sessionId],
    );
    expect(rows).toHaveLength(1);

    await chExec(
      "INSERT INTO raw.portal_event_ingest (raw) FORMAT JSONEachRow\n" +
        JSON.stringify({ raw: rows[0].payload }),
    );

    const landed = await chQuery<{ c: string }>(
      "SELECT count() AS c FROM raw.portal_events FINAL WHERE session_id = {s:String}",
      { params: { s: sessionId } },
    );
    expect(String(landed[0].c)).toBe("1");
  }, 60_000);

  it("no unconsented event can reach the outbox", async () => {
    const { rows } = await pool.query<{ c: string }>(
      `SELECT count(*) AS c FROM context.outbox_events o
        WHERE o.topic = 'portal.event'
          AND NOT EXISTS (
            SELECT 1 FROM context.consent_records cr
             WHERE cr.org_id = o.org_id
               AND cr.subject_ref = o.payload->>'session_id'
               AND cr.action = 'granted'
               AND cr.purposes @> ARRAY[o.payload->>'purpose']
          )`,
    );
    expect(Number(rows[0].c)).toBe(0);
  });

  it("the retired search_queries table has no writer left in the codebase", async () => {
    const { existsSync } = await import("node:fs");
    expect(existsSync(new URL("../../../lib/search/query-log.ts", import.meta.url))).toBe(false);
    const { rows } = await pool.query<{ c: string }>(
      `SELECT count(*) AS c FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'search_queries'`,
    );
    expect(Number(rows[0].c)).toBe(0);
  });
});
