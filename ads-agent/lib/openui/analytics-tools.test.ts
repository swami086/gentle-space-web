import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSpendCplTrend, listCampaignsWithLatestCpl, listProposals } = vi.hoisted(() => ({
  getSpendCplTrend: vi.fn(),
  listCampaignsWithLatestCpl: vi.fn(),
  listProposals: vi.fn(),
}));
vi.mock("../db/dashboard", () => ({ getSpendCplTrend, listCampaignsWithLatestCpl }));
vi.mock("../db/proposals", () => ({ listProposals }));

import { analyticsToolHandlers, analyticsToolProvider, analyticsToolSpecs } from "./analytics-tools";

const ORG = { kind: "org" as const, orgId: "org-1" };

beforeEach(() => {
  getSpendCplTrend.mockReset();
  listCampaignsWithLatestCpl.mockReset();
  listProposals.mockReset();
  process.env.ADS_AGENT_ORG_ID = "org-1";
});

describe("analyticsToolSpecs", () => {
  it("declares the three analytics tools by name", () => {
    expect(analyticsToolSpecs.map((s) => s.name).sort()).toEqual(
      ["get_spend_cpl_trend", "list_campaigns_with_cpl", "list_pending_proposals"].sort(),
    );
  });
});

describe("analyticsToolHandlers.get_spend_cpl_trend", () => {
  it("defaults to 7 days when no days arg is given", async () => {
    getSpendCplTrend.mockResolvedValue([{ date: "2026-08-01", spendInr: 1000, cplInr: 100 }]);
    const result = await analyticsToolHandlers.get_spend_cpl_trend(ORG, {});
    expect(getSpendCplTrend).toHaveBeenCalledWith(7);
    expect(result).toEqual([{ date: "2026-08-01", spendInr: 1000, cplInr: 100 }]);
  });

  it("uses the given days arg", async () => {
    getSpendCplTrend.mockResolvedValue([]);
    await analyticsToolHandlers.get_spend_cpl_trend(ORG, { days: 30 });
    expect(getSpendCplTrend).toHaveBeenCalledWith(30);
  });
});

describe("analyticsToolHandlers.list_campaigns_with_cpl", () => {
  it("delegates to listCampaignsWithLatestCpl", async () => {
    listCampaignsWithLatestCpl.mockResolvedValue([{ id: "1" }]);
    expect(await analyticsToolHandlers.list_campaigns_with_cpl(ORG, {})).toEqual([{ id: "1" }]);
  });
});

describe("analyticsToolHandlers.list_pending_proposals", () => {
  it("delegates to listProposals with status='pending'", async () => {
    listProposals.mockResolvedValue([{ id: "1" }]);
    expect(await analyticsToolHandlers.list_pending_proposals(ORG, {})).toEqual([{ id: "1" }]);
    expect(listProposals).toHaveBeenCalledWith(ORG, "pending");
  });
});

describe("analyticsToolProvider", () => {
  it("binds ADS_AGENT_ORG_ID when invoked through the Copilot registry", async () => {
    listProposals.mockResolvedValue([]);
    await analyticsToolProvider.list_pending_proposals({});
    expect(listProposals).toHaveBeenCalledWith(ORG, "pending");
  });
});
