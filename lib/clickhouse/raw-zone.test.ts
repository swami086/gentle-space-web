import { describe, it, expect, beforeAll } from "vitest";
import { chExec, chQuery, clickhouseConfig } from "./client";
import { applyMigrations } from "./migrate";

const live = Boolean(process.env.CLICKHOUSE_URL);
const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";

function line(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event_id: "11111111-0000-4000-8000-000000000001",
    org_id: ORG_A,
    event: "listing_view",
    purpose: "space_recommendation",
    session_id: "abcdefabcdefabcdef01",
    taxonomy_version: 1,
    occurred_at: "2026-08-12T09:00:00.000Z",
    payload: { listing_ref: "listing-7", dwell_seconds: 42 },
    ...overrides,
  });
}

async function insertLines(lines: string[]): Promise<void> {
  await chExec(
    `INSERT INTO raw.portal_event_ingest (raw) FORMAT JSONEachRow\n` +
      lines.map((l) => JSON.stringify({ raw: l })).join("\n"),
  );
}

describe.skipIf(!live)("raw zone", () => {
  beforeAll(async () => {
    await applyMigrations();
    await chExec("TRUNCATE TABLE raw.portal_events");
  });

  it("materialises a published event into typed columns", async () => {
    await insertLines([line()]);
    const [row] = await chQuery<{
      org_id: string; event: string; purpose: string; session_id: string;
      taxonomy_version: number; payload: string;
    }>(
      `SELECT toString(org_id) AS org_id, event, purpose, session_id, taxonomy_version, payload
         FROM raw.portal_events FINAL WHERE event_id = '11111111-0000-4000-8000-000000000001'`,
    );
    expect(row.org_id).toBe(ORG_A);
    expect(row.event).toBe("listing_view");
    expect(row.purpose).toBe("space_recommendation");
    expect(row.session_id).toBe("abcdefabcdefabcdef01");
    expect(row.taxonomy_version).toBe(1);
    expect(JSON.parse(row.payload)).toEqual({ listing_ref: "listing-7", dwell_seconds: 42 });
  });

  it("is idempotent under at-least-once delivery: the same event_id lands once", async () => {
    await insertLines([line({ event_id: "22222222-0000-4000-8000-000000000002" })]);
    await insertLines([line({ event_id: "22222222-0000-4000-8000-000000000002" })]);
    const [row] = await chQuery<{ c: string }>(
      `SELECT count() AS c FROM raw.portal_events FINAL
        WHERE event_id = '22222222-0000-4000-8000-000000000002'`,
    );
    expect(String(row.c)).toBe("1");
  });

  it("partitions by purpose and day so retention expiry is a partition drop", async () => {
    const [row] = await chQuery<{ partition_key: string }>(
      "SELECT partition_key FROM system.tables WHERE database = 'raw' AND name = 'portal_events'",
    );
    expect(row.partition_key).toContain("purpose");
    expect(row.partition_key).toContain("occurred_on");
  });

  it("hides other tenants' events from a policy-covered reader", async () => {
    await insertLines([line({ event_id: "33333333-0000-4000-8000-000000000003", org_id: ORG_B })]);
    const tenantConfig = {
      ...clickhouseConfig(),
      user: "tenant_reader",
      password: process.env.CLICKHOUSE_TENANT_PASSWORD ?? "tenant",
    };
    const rows = await chQuery<{ org_id: string }>(
      "SELECT DISTINCT toString(org_id) AS org_id FROM raw.portal_events FINAL",
      { config: tenantConfig, settings: { SQL_current_tenant_id: ORG_B } },
    );
    expect(rows.map((r) => r.org_id)).toEqual([ORG_B]);
  });

  it("drops a line with no org_id rather than storing an untenanted event", async () => {
    await insertLines(['{"event":"page_view","payload":{}}']);
    const [row] = await chQuery<{ c: string }>(
      "SELECT count() AS c FROM raw.portal_events FINAL WHERE org_id = toUUID('00000000-0000-0000-0000-000000000000')",
    );
    expect(String(row.c)).toBe("0");
  });
});
