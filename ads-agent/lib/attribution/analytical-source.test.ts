import { describe, it, expect, vi } from "vitest";
import {
  corridorEnquirySql,
  corridorSpendSql,
  fetchCorridorEnquiries,
  fetchCorridorSpend,
  fetchSourceWatermark,
  type AnalyticalQuery,
} from "./analytical-source";

const ORG = "55555555-5555-5555-5555-555555555555";
const SCOPE = { kind: "org" as const, orgId: ORG };
const WINDOW = { startDate: "2026-08-01", endDate: "2026-08-07" };

describe("the SQL targets the analytical mirror, not the primary", () => {
  it("reads spend from spend_fact with a tenant-leading filter", () => {
    const sql = corridorSpendSql();
    expect(sql).toContain("FROM spend_fact");
    expect(sql).toContain("org_id = {org_id:UUID}");
    expect(sql).toContain("GROUP BY corridor_id");
  });

  it("reads enquiries from enquiry_fact, the S6 mirror table", () => {
    const sql = corridorEnquirySql();
    expect(sql).toContain("FROM enquiry_fact");
    expect(sql).toContain("org_id = {org_id:UUID}");
  });

  it("never references a Postgres schema — the join stays inside ClickHouse", () => {
    for (const sql of [corridorSpendSql(), corridorEnquirySql()]) {
      expect(sql).not.toMatch(/\b(adsagent|listings|derived|public)\./);
    }
  });
});

describe("fetchCorridorSpend", () => {
  it("binds the org and the window as named parameters", async () => {
    const query = vi.fn().mockResolvedValue([]) as unknown as AnalyticalQuery;
    await fetchCorridorSpend(SCOPE, query, WINDOW);
    expect(query).toHaveBeenCalledWith(corridorSpendSql(), {
      org_id: ORG,
      start: "2026-08-01",
      end: "2026-08-07",
    });
  });

  it("maps a null corridor to null rather than dropping the row", async () => {
    const query = vi
      .fn()
      .mockResolvedValue([
        { corridor_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", spend_inr: "1000.5" },
        { corridor_id: null, spend_inr: "600" },
      ]) as unknown as AnalyticalQuery;

    expect(await fetchCorridorSpend(SCOPE, query, WINDOW)).toEqual([
      { corridorId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", spendInr: 1000.5 },
      { corridorId: null, spendInr: 600 },
    ]);
  });

  it("uses the org id even under platform scope, because this path never spans tenants", async () => {
    const query = vi.fn().mockResolvedValue([]) as unknown as AnalyticalQuery;
    await fetchCorridorSpend({ kind: "platform", orgId: ORG }, query, WINDOW);
    expect(query).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ org_id: ORG }));
  });
});

describe("fetchCorridorEnquiries", () => {
  it("returns counts as numbers, preserving the null corridor bucket", async () => {
    const query = vi
      .fn()
      .mockResolvedValue([
        { corridor_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", enquiry_count: "4" },
        { corridor_id: null, enquiry_count: "2" },
      ]) as unknown as AnalyticalQuery;

    expect(await fetchCorridorEnquiries(SCOPE, query, WINDOW)).toEqual([
      { corridorId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", enquiryCount: 4 },
      { corridorId: null, enquiryCount: 2 },
    ]);
  });
});

describe("fetchSourceWatermark", () => {
  it("returns the newest mirrored commit timestamp", async () => {
    const query = vi
      .fn()
      .mockResolvedValue([{ watermark: "2026-08-12 10:00:00.000" }]) as unknown as AnalyticalQuery;
    expect((await fetchSourceWatermark(SCOPE, query)).toISOString()).toBe("2026-08-12T10:00:00.000Z");
  });

  it("throws when the mirror reports no watermark, rather than assuming now()", async () => {
    const query = vi.fn().mockResolvedValue([]) as unknown as AnalyticalQuery;
    await expect(fetchSourceWatermark(SCOPE, query)).rejects.toThrow(/no watermark/);
  });
});
