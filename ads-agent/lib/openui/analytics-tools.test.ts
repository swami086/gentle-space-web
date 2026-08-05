import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSpendCplTrend, listCampaignsWithLatestCpl, listProposals } = vi.hoisted(() => ({
  getSpendCplTrend: vi.fn(),
  listCampaignsWithLatestCpl: vi.fn(),
  listProposals: vi.fn(),
}));
vi.mock("../db/dashboard", () => ({ getSpendCplTrend, listCampaignsWithLatestCpl }));
vi.mock("../db/proposals", () => ({ listProposals }));

import { analyticsToolProvider, analyticsToolSpecs } from "./analytics-tools";

beforeEach(() => {
  getSpendCplTrend.mockReset();
  listCampaignsWithLatestCpl.mockReset();
  listProposals.mockReset();
});

describe("analyticsToolSpecs", () => {
  it("declares the three analytics tools by name", () => {
    expect(analyticsToolSpecs.map((s) => s.name).sort()).toEqual(
      ["get_spend_cpl_trend", "list_campaigns_with_cpl", "list_pending_proposals"].sort(),
    );
  });
});

describe("analyticsToolProvider.get_spend_cpl_trend", () => {
  it("defaults to 7 days when no days arg is given", async () => {
    getSpendCplTrend.mockResolvedValue([{ date: "2026-08-01", spendInr: 1000, cplInr: 100 }]);
    const result = await analyticsToolProvider.get_spend_cpl_trend({});
    expect(getSpendCplTrend).toHaveBeenCalledWith(7);
    expect(result).toEqual([{ date: "2026-08-01", spendInr: 1000, cplInr: 100 }]);
  });

  it("uses the given days arg", async () => {
    getSpendCplTrend.mockResolvedValue([]);
    await analyticsToolProvider.get_spend_cpl_trend({ days: 30 });
    expect(getSpendCplTrend).toHaveBeenCalledWith(30);
  });
});

describe("analyticsToolProvider.list_campaigns_with_cpl", () => {
  it("delegates to listCampaignsWithLatestCpl", async () => {
    listCampaignsWithLatestCpl.mockResolvedValue([{ id: "1" }]);
    expect(await analyticsToolProvider.list_campaigns_with_cpl({})).toEqual([{ id: "1" }]);
  });
});

describe("analyticsToolProvider.list_pending_proposals", () => {
  it("delegates to listProposals with status='pending'", async () => {
    listProposals.mockResolvedValue([{ id: "1" }]);
    expect(await analyticsToolProvider.list_pending_proposals({})).toEqual([{ id: "1" }]);
    expect(listProposals).toHaveBeenCalledWith("pending");
  });
});
