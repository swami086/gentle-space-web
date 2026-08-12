import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSpendCplTrend, listCampaignsWithLatestCpl, listProposals, readAttribution, corridorListingIds } =
  vi.hoisted(() => ({
    getSpendCplTrend: vi.fn(),
    listCampaignsWithLatestCpl: vi.fn(),
    listProposals: vi.fn(),
    readAttribution: vi.fn(),
    corridorListingIds: vi.fn(),
  }));
vi.mock("../db/dashboard", () => ({ getSpendCplTrend, listCampaignsWithLatestCpl }));
vi.mock("../db/proposals", () => ({ listProposals }));
vi.mock("../db/attribution", () => ({ readAttribution }));
vi.mock("../db/corridors", () => ({ corridorListingIds }));

import { analyticsToolHandlers, analyticsToolProvider, analyticsToolSpecs } from "./analytics-tools";

const ORG = { kind: "org" as const, orgId: "org-1" };
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const STORED = {
  window: { startDate: "2026-08-06", endDate: "2026-08-12" },
  windowState: "open" as const,
  corridors: [
    { corridorId: A, spendInr: 1000, enquiryCount: 4, costPerEnquiryInr: 250, authority: "derived" as const },
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
    computedAt: "2026-08-12T08:00:00.000Z",
    sourceWatermark: "2026-08-12T07:59:00.000Z",
    cdcLagSeconds: 60,
    isStale: false,
  },
  authority: "derived" as const,
};

beforeEach(() => {
  getSpendCplTrend.mockReset();
  listCampaignsWithLatestCpl.mockReset();
  listProposals.mockReset();
  readAttribution.mockReset();
  corridorListingIds.mockReset();
  process.env.ADS_AGENT_ORG_ID = "org-1";
});

describe("analyticsToolSpecs", () => {
  it("declares every analytics tool by name", () => {
    expect(analyticsToolSpecs.map((s) => s.name).sort()).toEqual(
      [
        "get_corridor_attribution",
        "get_per_space_cost_estimate",
        "get_spend_cpl_trend",
        "list_campaigns_with_cpl",
        "list_pending_proposals",
      ].sort(),
    );
  });

  it("says in the description that per-space cost is an estimate", () => {
    const spec = analyticsToolSpecs.find((s) => s.name === "get_per_space_cost_estimate")!;
    expect(spec.description.toLowerCase()).toContain("estimate");
  });
});

describe("analyticsToolHandlers.get_spend_cpl_trend", () => {
  it("defaults to 7 days when no days arg is given", async () => {
    getSpendCplTrend.mockResolvedValue([{ date: "2026-08-01", spendInr: 1000, cplInr: 100 }]);
    const result = await analyticsToolHandlers.get_spend_cpl_trend(ORG, {});
    expect(getSpendCplTrend).toHaveBeenCalledWith(ORG, 7);
    expect(result).toEqual([{ date: "2026-08-01", spendInr: 1000, cplInr: 100 }]);
  });

  it("uses the given days arg", async () => {
    getSpendCplTrend.mockResolvedValue([]);
    await analyticsToolHandlers.get_spend_cpl_trend(ORG, { days: 30 });
    expect(getSpendCplTrend).toHaveBeenCalledWith(ORG, 30);
  });
});

describe("analyticsToolHandlers.list_campaigns_with_cpl", () => {
  it("delegates to listCampaignsWithLatestCpl", async () => {
    listCampaignsWithLatestCpl.mockResolvedValue([{ id: "1" }]);
    expect(await analyticsToolHandlers.list_campaigns_with_cpl(ORG, {})).toEqual([{ id: "1" }]);
    expect(listCampaignsWithLatestCpl).toHaveBeenCalledWith(ORG);
  });
});

describe("analyticsToolHandlers.list_pending_proposals", () => {
  it("delegates to listProposals with status='pending'", async () => {
    listProposals.mockResolvedValue([{ id: "1" }]);
    expect(await analyticsToolHandlers.list_pending_proposals(ORG, {})).toEqual([{ id: "1" }]);
    expect(listProposals).toHaveBeenCalledWith(ORG, "pending");
  });
});

describe("analyticsToolHandlers.get_corridor_attribution", () => {
  beforeEach(() => readAttribution.mockReset().mockResolvedValue(STORED));

  it("returns the residual alongside the corridors, tagged derived", async () => {
    const out = (await analyticsToolHandlers.get_corridor_attribution(ORG, { days: 7 })) as Record<
      string,
      unknown
    >;
    expect(out.authority).toBe("derived");
    expect(out.residual).toEqual(STORED.residual);
    expect(out.corridors).toHaveLength(1);
  });

  it("defaults to a 7-day window", async () => {
    await analyticsToolHandlers.get_corridor_attribution(ORG, {});
    expect(readAttribution.mock.calls[0][1]).toHaveProperty("startDate");
  });

  it("returns an explicit not-computed marker rather than empty numbers", async () => {
    readAttribution.mockResolvedValue(null);
    const out = (await analyticsToolHandlers.get_corridor_attribution(ORG, {})) as Record<string, unknown>;
    expect(out).toEqual({ computed: false, reason: "no attribution has been computed for this window" });
  });
});

describe("analyticsToolHandlers.get_per_space_cost_estimate", () => {
  beforeEach(() => {
    readAttribution.mockReset().mockResolvedValue(STORED);
    corridorListingIds.mockReset().mockResolvedValue(["l1", "l2"]);
  });

  it("labels every row as an equal-split estimate", async () => {
    const out = (await analyticsToolHandlers.get_per_space_cost_estimate(ORG, {
      corridorId: A,
      days: 7,
    })) as { estimates: { isEstimate: boolean; basis: string; estimatedSpendShareInr: number }[] };

    expect(out.estimates).toHaveLength(2);
    for (const row of out.estimates) {
      expect(row.isEstimate).toBe(true);
      expect(row.basis).toBe("equal_split");
      expect(row.estimatedSpendShareInr).toBe(500);
    }
  });

  it("requires a corridorId rather than guessing one", async () => {
    await expect(analyticsToolHandlers.get_per_space_cost_estimate(ORG, {})).rejects.toThrow(/corridorId/);
  });

  it("returns no estimates for a corridor absent from the window", async () => {
    const out = (await analyticsToolHandlers.get_per_space_cost_estimate(ORG, {
      corridorId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    })) as { estimates: unknown[]; reason: string };
    expect(out.estimates).toEqual([]);
    expect(out.reason).toMatch(/no spend or enquiries/);
  });
});

describe("analyticsToolProvider", () => {
  it("binds ADS_AGENT_ORG_ID when invoked through the Copilot registry", async () => {
    listProposals.mockResolvedValue([]);
    await analyticsToolProvider.list_pending_proposals({});
    expect(listProposals).toHaveBeenCalledWith(ORG, "pending");
  });
});
