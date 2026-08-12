import { describe, it, expect, beforeAll } from "vitest";
import { chExec, chQuery } from "./client";
import { applyMigrations } from "./migrate";

const live = Boolean(process.env.CLICKHOUSE_URL);
const ORG = "aaaaaaaa-0000-4000-8000-000000000001";

function searchLine(eventId: string, resultCount: number): string {
  return JSON.stringify({
    event_id: eventId,
    org_id: ORG,
    event: "search_performed",
    purpose: "space_recommendation",
    session_id: "abcdefabcdefabcdef01",
    taxonomy_version: 1,
    occurred_at: "2026-08-12T09:00:00.000Z",
    payload: { query: "hsr layout 20 desks", filters: {}, result_count: resultCount },
  });
}

describe.skipIf(!live)("rollups", () => {
  beforeAll(async () => {
    await applyMigrations();
    await chExec("TRUNCATE TABLE raw.portal_events");
    await chExec("TRUNCATE TABLE analytics.portal_event_daily");
    await chExec("TRUNCATE TABLE analytics.search_performed_daily");
    await chExec(
      "INSERT INTO raw.portal_event_ingest (raw) FORMAT JSONEachRow\n" +
        [
          JSON.stringify({ raw: searchLine("44444444-0000-4000-8000-000000000004", 0) }),
          JSON.stringify({ raw: searchLine("55555555-0000-4000-8000-000000000005", 7) }),
        ].join("\n"),
    );
  });

  it("counts events per tenant, day and event kind", async () => {
    const [row] = await chQuery<{ events: string }>(
      `SELECT toString(sum(events)) AS events FROM analytics.portal_event_daily
        WHERE org_id = {org:UUID} AND event = 'search_performed'`,
      { params: { org: ORG } },
    );
    expect(String(row.events)).toBe("2");
  });

  it("keeps zero-result searches distinguishable, which search_queries could not", async () => {
    const rows = await chQuery<{ zero_result: number; searches: string }>(
      `SELECT zero_result, toString(sum(searches)) AS searches
         FROM analytics.search_performed_daily
        WHERE org_id = {org:UUID}
        GROUP BY zero_result ORDER BY zero_result`,
      { params: { org: ORG } },
    );
    expect(rows).toEqual([
      { zero_result: 0, searches: "1" },
      { zero_result: 1, searches: "1" },
    ]);
  });

  it("leads both rollup sort keys with org_id", async () => {
    const rows = await chQuery<{ name: string }>(
      `SELECT name FROM system.tables
        WHERE database = 'analytics' AND name LIKE '%_daily' AND position(sorting_key, 'org_id') != 1`,
    );
    expect(rows).toEqual([]);
  });
});
