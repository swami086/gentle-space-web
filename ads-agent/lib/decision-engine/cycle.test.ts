import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Campaign } from "../types";

const {
  listCampaigns,
  recordPerformanceSnapshot,
  recentPerformanceSnapshots,
  recordCrmSignalSnapshot,
  createProposal,
  fetchMetaPerformance,
  fetchGoogleAdsPerformance,
  fetchGoogleSearchTerms,
  fetchLeadSignal,
  evaluateRules,
  draftRationale,
  logAiAction,
} = vi.hoisted(() => ({
  listCampaigns: vi.fn(),
  recordPerformanceSnapshot: vi.fn(),
  recentPerformanceSnapshots: vi.fn(),
  recordCrmSignalSnapshot: vi.fn(),
  createProposal: vi.fn(),
  fetchMetaPerformance: vi.fn(),
  fetchGoogleAdsPerformance: vi.fn(),
  fetchGoogleSearchTerms: vi.fn(),
  fetchLeadSignal: vi.fn(),
  evaluateRules: vi.fn(),
  draftRationale: vi.fn(),
  logAiAction: vi.fn(),
}));

vi.mock("../db/campaigns", () => ({ listCampaigns }));
vi.mock("../db/snapshots", () => ({
  recordPerformanceSnapshot,
  recentPerformanceSnapshots,
  recordCrmSignalSnapshot,
}));
vi.mock("../db/proposals", () => ({ createProposal }));
vi.mock("../connectors/meta", () => ({ fetchMetaPerformance }));
vi.mock("../connectors/google-ads", () => ({ fetchGoogleAdsPerformance, fetchGoogleSearchTerms }));
vi.mock("../connectors/twenty", () => ({ fetchLeadSignal }));
vi.mock("./rules", () => ({ evaluateRules }));
vi.mock("./rationale", () => ({ draftRationale }));
vi.mock("../db/ai-action-log", () => ({ logAiAction }));

import { runDecisionCycle } from "./cycle";

const googleCampaign: Campaign = {
  id: "camp-google",
  platform: "google",
  externalId: "111",
  name: "Whitefield Search",
  status: "active",
  dailyBudget: 500,
  corridor: "whitefield",
  createdAt: "2026-08-01T00:00:00.000Z",
};
const metaCampaign: Campaign = {
  id: "camp-meta",
  platform: "meta",
  externalId: "222",
  name: "Whitefield Advantage+",
  status: "active",
  dailyBudget: 500,
  corridor: "whitefield",
  createdAt: "2026-08-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  listCampaigns.mockResolvedValue([googleCampaign, metaCampaign]);
  fetchGoogleAdsPerformance.mockResolvedValue([
    { externalCampaignId: "111", spend: 400, clicks: 20, impressions: 900, conversions: 1 },
  ]);
  fetchGoogleSearchTerms.mockResolvedValue([
    { externalCampaignId: "111", searchTerm: "1bhk for rent", clicks: 3, conversions: 0 },
  ]);
  fetchMetaPerformance.mockResolvedValue([
    { externalCampaignId: "222", spend: 300, clicks: 15, impressions: 800, conversions: 0 },
  ]);
  fetchLeadSignal.mockResolvedValue({ hotCount: 2, warmCount: 1, coldCount: 3, unscoredCount: 0 });
  recentPerformanceSnapshots.mockResolvedValue([]);
  evaluateRules.mockReturnValue([]);
});

describe("runDecisionCycle", () => {
  it("records a performance snapshot per campaign mapped by externalId, and the CRM signal", async () => {
    await runDecisionCycle();

    expect(recordPerformanceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "camp-google", spend: 400, conversions: 1 }),
    );
    expect(recordPerformanceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "camp-meta", spend: 300, conversions: 0 }),
    );
    expect(recordCrmSignalSnapshot).toHaveBeenCalledWith({
      campaignId: null,
      hotCount: 2,
      warmCount: 1,
      coldCount: 3,
      unscoredCount: 0,
    });
  });

  it("passes mapped search terms with local campaign ids into evaluateRules", async () => {
    await runDecisionCycle();
    const ruleInput = evaluateRules.mock.calls[0][0];
    expect(ruleInput.searchTerms).toEqual([
      { campaignId: "camp-google", searchTerm: "1bhk for rent", clicks: 3, conversions: 0 },
    ]);
  });

  it("drafts a rationale and creates a proposal for every rule triggered", async () => {
    evaluateRules.mockReturnValue([
      { kind: "pause", campaignId: "camp-google", triggeredRule: "kill_rule", payload: {} },
    ]);
    draftRationale.mockResolvedValue("CPL has been too high for 3 days.");

    const result = await runDecisionCycle();

    expect(draftRationale).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "pause", campaignId: "camp-google" }),
    );
    expect(createProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "pause",
        campaignId: "camp-google",
        rationale: "CPL has been too high for 3 days.",
      }),
    );
    expect(result).toEqual({ proposalsCreated: 1 });
  });

  it("returns proposalsCreated: 0 when no rule triggers", async () => {
    await expect(runDecisionCycle()).resolves.toEqual({ proposalsCreated: 0 });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("skips performance rows for external ids with no matching local campaign", async () => {
    fetchGoogleAdsPerformance.mockResolvedValue([
      { externalCampaignId: "unknown-ext-id", spend: 999, clicks: 1, impressions: 1, conversions: 0 },
    ]);
    await runDecisionCycle();
    expect(recordPerformanceSnapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({ spend: 999 }),
    );
  });

  it("logs one ai_action_log row summarizing the count when proposals are created", async () => {
    listCampaigns.mockResolvedValue([]);
    fetchGoogleAdsPerformance.mockResolvedValue([]);
    fetchMetaPerformance.mockResolvedValue([]);
    fetchGoogleSearchTerms.mockResolvedValue([]);
    fetchLeadSignal.mockResolvedValue({ hotCount: 0, warmCount: 0, coldCount: 0, unscoredCount: 0 });
    recentPerformanceSnapshots.mockResolvedValue([]);
    evaluateRules.mockReturnValue([{ kind: "pause", campaignId: "c1", payload: {}, triggeredRule: "r1" }]);
    draftRationale.mockResolvedValue("rationale");
    createProposal.mockResolvedValue({});

    await runDecisionCycle();

    expect(logAiAction).toHaveBeenCalledWith({ domain: "marketing", summary: "Created 1 proposal" });
  });

  it("does not log when no proposals are created", async () => {
    listCampaigns.mockResolvedValue([]);
    fetchGoogleAdsPerformance.mockResolvedValue([]);
    fetchMetaPerformance.mockResolvedValue([]);
    fetchGoogleSearchTerms.mockResolvedValue([]);
    fetchLeadSignal.mockResolvedValue({ hotCount: 0, warmCount: 0, coldCount: 0, unscoredCount: 0 });
    recentPerformanceSnapshots.mockResolvedValue([]);
    evaluateRules.mockReturnValue([]);

    await runDecisionCycle();

    expect(logAiAction).not.toHaveBeenCalled();
  });
});
