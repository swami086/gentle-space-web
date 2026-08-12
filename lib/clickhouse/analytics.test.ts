import { describe, it, expect, beforeAll } from "vitest";
import { chExec, chQuery, clickhouseConfig } from "./client";
import { applyMigrations } from "./migrate";

const live = Boolean(process.env.CLICKHOUSE_URL);
const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";

describe.skipIf(!live)("analytics.enquiry_fact", () => {
  beforeAll(async () => {
    await applyMigrations();
    await chExec("TRUNCATE TABLE analytics.enquiry_fact");
    await chExec(
      `INSERT INTO analytics.enquiry_fact
         (org_id, enquiry_id, reply_state, first_seen_at, updated_at, snapshot_id)
       VALUES
         ({a:UUID}, generateUUIDv4(), 'waiting', now64(3), now64(3), toUUID('00000000-0000-0000-0000-000000000000')),
         ({b:UUID}, generateUUIDv4(), 'called',  now64(3), now64(3), toUUID('00000000-0000-0000-0000-000000000000'))`,
      { params: { a: ORG_A, b: ORG_B } },
    );
  });

  it("leads its sort key with org_id", async () => {
    const [row] = await chQuery<{ sorting_key: string }>(
      "SELECT sorting_key FROM system.tables WHERE database = 'analytics' AND name = 'enquiry_fact'",
    );
    expect(row.sorting_key.startsWith("org_id")).toBe(true);
  });

  it("deduplicates a re-replicated row rather than doubling it", async () => {
    const id = "cccccccc-0000-4000-8000-000000000003";
    for (const state of ["waiting", "called"]) {
      await chExec(
        `INSERT INTO analytics.enquiry_fact
           (org_id, enquiry_id, reply_state, first_seen_at, updated_at, snapshot_id)
         VALUES ({a:UUID}, {id:UUID}, {s:String}, toDateTime64('2026-08-01 00:00:00.000', 3),
                 now64(3), toUUID('00000000-0000-0000-0000-000000000000'))`,
        { params: { a: ORG_A, id, s: state } },
      );
    }
    const [row] = await chQuery<{ c: string; reply_state: string }>(
      `SELECT count() AS c, any(reply_state) AS reply_state
         FROM analytics.enquiry_fact FINAL WHERE enquiry_id = {id:UUID}`,
      { params: { id } },
    );
    expect(String(row.c)).toBe("1");
    expect(row.reply_state).toBe("called");
  });

  it("hides other tenants' rows from a policy-covered reader", async () => {
    const tenantConfig = {
      ...clickhouseConfig(),
      user: "tenant_reader",
      password: process.env.CLICKHOUSE_TENANT_PASSWORD ?? "tenant",
    };
    const rows = await chQuery<{ org_id: string }>(
      "SELECT DISTINCT org_id FROM analytics.enquiry_fact FINAL",
      { config: tenantConfig, settings: { SQL_current_tenant_id: ORG_A } },
    );
    expect(rows.map((r) => r.org_id)).toEqual([ORG_A]);
  });

  it("shows nothing when the tenant setting is left at its default", async () => {
    const tenantConfig = {
      ...clickhouseConfig(),
      user: "tenant_reader",
      password: process.env.CLICKHOUSE_TENANT_PASSWORD ?? "tenant",
    };
    const rows = await chQuery("SELECT org_id FROM analytics.enquiry_fact FINAL", { config: tenantConfig });
    expect(rows).toEqual([]);
  });
});
