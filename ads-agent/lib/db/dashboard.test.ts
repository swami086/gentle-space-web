import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
}));

const { readAttribution, listCorridors } = vi.hoisted(() => ({
  readAttribution: vi.fn(),
  listCorridors: vi.fn(),
}));
vi.mock("./attribution", () => ({ readAttribution }));
vi.mock("./corridors", () => ({ listCorridors }));

import type { Scope } from "./scope-sql";
import { getCorridorCosts, getOverviewStats, getSpendCplTrend, listCampaignsWithLatestCpl } from "./dashboard";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const NOW = new Date("2026-08-12T08:00:00Z");

beforeEach(() => {
  query.mockReset();
  readAttribution.mockReset().mockResolvedValue(null);
  listCorridors.mockReset().mockResolvedValue([]);
});

describe("getOverviewStats", () => {
  it("scopes all three aggregates and computes blended CPL", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: "3" }] })
      .mockResolvedValueOnce({ rows: [{ count: "2" }] })
      .mockResolvedValueOnce({ rows: [{ spend: "4000", conversions: "8" }] });

    await expect(getOverviewStats(ORG)).resolves.toEqual({
      activeCampaignCount: 3,
      pendingProposalCount: 2,
      monthSpendInr: 4000,
      blendedCplInr: 500,
      costPerEnquiryInr: null,
      attributionIsStale: false,
    });
    for (const call of query.mock.calls) {
      expect(call[0]).toContain("org_id = $1::uuid");
      expect(call[1]).toEqual([ORG.orgId]);
    }
  });

  it("reports a null blended CPL when there were no conversions", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: "0" }] })
      .mockResolvedValueOnce({ rows: [{ count: "0" }] })
      .mockResolvedValueOnce({ rows: [{ spend: "0", conversions: "0" }] });
    const stats = await getOverviewStats(ORG);
    expect(stats.blendedCplInr).toBeNull();
    expect(stats.costPerEnquiryInr).toBeNull();
  });
});

describe("getSpendCplTrend", () => {
  it("parameterises the day window instead of interpolating it", async () => {
    query.mockResolvedValue({ rows: [] });
    await getSpendCplTrend(ORG, 30);
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toContain("INTERVAL '30");
    expect(sql).toContain("($2 || ' days')::interval");
    expect(params).toEqual([ORG.orgId, 30]);
  });
});

describe("listCampaignsWithLatestCpl", () => {
  it("scopes the outer query and the lateral join", async () => {
    query.mockResolvedValue({ rows: [] });
    await listCampaignsWithLatestCpl(ORG);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("c.org_id = $1::uuid");
    expect(sql).toContain("p.org_id = c.org_id");
    expect(sql).toContain("public.corridors");
    expect(params).toEqual([ORG.orgId]);
  });
});

describe("getCorridorCosts", () => {
  beforeEach(() => {
    listCorridors.mockReset().mockResolvedValue([
      { id: A, slug: "hsr-layout", displayName: "HSR Layout", city: "Bangalore", parentId: null },
    ]);
  });

  it("joins the stored rollup to corridor display names and carries the residual", async () => {
    readAttribution.mockResolvedValue({
      window: { startDate: "2026-08-06", endDate: "2026-08-12" },
      windowState: "open",
      corridors: [
        { corridorId: A, spendInr: 1000, enquiryCount: 4, costPerEnquiryInr: 250, authority: "derived" },
      ],
      residual: {
        unattributedSpendInr: 600,
        unattributedEnquiryCount: 2,
        spendWithoutEnquiriesInr: 0,
        enquiriesWithoutSpendCount: 0,
      },
      lateEnquiryCount: 0,
      totals: { spendInr: 1600, enquiryCount: 6 },
      freshness: {
        computedAt: "2026-08-12T07:59:00.000Z",
        sourceWatermark: "2026-08-12T07:58:00.000Z",
        cdcLagSeconds: 60,
        isStale: false,
      },
      authority: "derived",
    });

    const summary = await getCorridorCosts(ORG, 7, NOW);

    expect(readAttribution).toHaveBeenCalledWith(ORG, {
      startDate: "2026-08-06",
      endDate: "2026-08-12",
    });
    expect(summary!.rows).toEqual([
      {
        corridorId: A,
        corridorName: "HSR Layout",
        spendInr: 1000,
        enquiryCount: 4,
        costPerEnquiryInr: 250,
        authority: "derived",
      },
    ]);
    expect(summary!.residual.unattributedSpendInr).toBe(600);
    expect(summary!.isStale).toBe(false);
  });

  it("shows a corridor whose id has no vocabulary row without inventing a name", async () => {
    listCorridors.mockResolvedValue([]);
    readAttribution.mockResolvedValue({
      window: { startDate: "2026-08-06", endDate: "2026-08-12" },
      windowState: "open",
      corridors: [
        { corridorId: A, spendInr: 10, enquiryCount: 0, costPerEnquiryInr: null, authority: "derived" },
      ],
      residual: {
        unattributedSpendInr: 0,
        unattributedEnquiryCount: 0,
        spendWithoutEnquiriesInr: 10,
        enquiriesWithoutSpendCount: 0,
      },
      lateEnquiryCount: 0,
      totals: { spendInr: 10, enquiryCount: 0 },
      freshness: {
        computedAt: "2026-08-12T07:59:00.000Z",
        sourceWatermark: "2026-08-12T07:58:00.000Z",
        cdcLagSeconds: 60,
        isStale: false,
      },
      authority: "derived",
    });

    const summary = await getCorridorCosts(ORG, 7, NOW);
    expect(summary!.rows[0].corridorName).toBe("Unnamed corridor");
    expect(summary!.rows[0].costPerEnquiryInr).toBeNull();
  });

  it("returns null when the window has not been computed", async () => {
    readAttribution.mockResolvedValue(null);
    expect(await getCorridorCosts(ORG, 7, NOW)).toBeNull();
  });
});
