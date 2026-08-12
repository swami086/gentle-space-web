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
  writeAudit,
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
  writeAudit: vi.fn(),
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
vi.mock("../db/audit-log", () => ({ writeAudit }));

import { runDecisionCycle } from "./cycle";

const ORG = { kind: "org" as const, orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

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
    await runDecisionCycle(ORG);

    expect(recordPerformanceSnapshot).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ campaignId: "camp-google", spend: 400, conversions: 1 }),
    );
    expect(recordPerformanceSnapshot).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ campaignId: "camp-meta", spend: 300, conversions: 0 }),
    );
    expect(recordCrmSignalSnapshot).toHaveBeenCalledWith(ORG, {
      campaignId: null,
      hotCount: 2,
      warmCount: 1,
      coldCount: 3,
      unscoredCount: 0,
    });
  });

  it("passes mapped search terms with local campaign ids into evaluateRules", async () => {
    await runDecisionCycle(ORG);
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

    const result = await runDecisionCycle(ORG);

    expect(draftRationale).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "pause", campaignId: "camp-google" }),
    );
    expect(createProposal).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        kind: "pause",
        campaignId: "camp-google",
        rationale: "CPL has been too high for 3 days.",
      }),
    );
    expect(result).toEqual({ proposalsCreated: 1 });
  });

  it("returns proposalsCreated: 0 when no rule triggers", async () => {
    await expect(runDecisionCycle(ORG)).resolves.toEqual({ proposalsCreated: 0 });
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("skips performance rows for external ids with no matching local campaign", async () => {
    fetchGoogleAdsPerformance.mockResolvedValue([
      { externalCampaignId: "unknown-ext-id", spend: 999, clicks: 1, impressions: 1, conversions: 0 },
    ]);
    await runDecisionCycle(ORG);
    expect(recordPerformanceSnapshot).not.toHaveBeenCalledWith(
      ORG,
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

    await runDecisionCycle(ORG);

    expect(writeAudit).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({
        actorType: "agent",
        action: "cycle.run",
        entityType: "cycle",
        after: expect.objectContaining({ proposalsCreated: 1, summary: "Created 1 proposal" }),
      }),
    );
  });

  it("does not log when no proposals are created", async () => {
    listCampaigns.mockResolvedValue([]);
    fetchGoogleAdsPerformance.mockResolvedValue([]);
    fetchMetaPerformance.mockResolvedValue([]);
    fetchGoogleSearchTerms.mockResolvedValue([]);
    fetchLeadSignal.mockResolvedValue({ hotCount: 0, warmCount: 0, coldCount: 0, unscoredCount: 0 });
    recentPerformanceSnapshots.mockResolvedValue([]);
    evaluateRules.mockReturnValue([]);

    await runDecisionCycle(ORG);

    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("still records the Meta snapshot when fetchGoogleAdsPerformance rejects (MCP server unreachable)", async () => {
    fetchGoogleAdsPerformance.mockRejectedValue(new Error("google ads mcp: connect ECONNREFUSED"));

    await expect(runDecisionCycle(ORG)).resolves.toEqual({ proposalsCreated: 0 });

    expect(recordPerformanceSnapshot).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ campaignId: "camp-meta", spend: 300 }),
    );
    expect(recordPerformanceSnapshot).not.toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ campaignId: "camp-google" }),
    );
  });

  it("still records the Google Ads snapshot when fetchMetaPerformance rejects", async () => {
    fetchMetaPerformance.mockRejectedValue(new Error("meta: rate limited"));

    await expect(runDecisionCycle(ORG)).resolves.toEqual({ proposalsCreated: 0 });

    expect(recordPerformanceSnapshot).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ campaignId: "camp-google", spend: 400 }),
    );
  });

  it("passes an empty search-terms list into evaluateRules when fetchGoogleSearchTerms rejects, without throwing", async () => {
    fetchGoogleSearchTerms.mockRejectedValue(new Error("google ads mcp: connect ECONNREFUSED"));

    await runDecisionCycle(ORG);

    const ruleInput = evaluateRules.mock.calls[0][0];
    expect(ruleInput.searchTerms).toEqual([]);
  });
});
