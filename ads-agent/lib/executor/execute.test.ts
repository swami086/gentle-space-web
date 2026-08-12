import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Campaign, Proposal } from "../types";

const {
  getProposalById,
  markProposalExecuted,
  markProposalFailed,
  createCampaignRecord,
  markCampaignActive,
  updateCampaignBudget,
  updateCampaignStatus,
  getCampaignById,
  createMetaCampaign,
  pauseMetaCampaign,
  updateMetaCampaignBudget,
  createFullGoogleCampaign,
  pauseGoogleCampaign,
  updateGoogleCampaignBudget,
  addGoogleNegativeKeyword,
} = vi.hoisted(() => ({
  getProposalById: vi.fn(),
  markProposalExecuted: vi.fn(),
  markProposalFailed: vi.fn(),
  createCampaignRecord: vi.fn(),
  markCampaignActive: vi.fn(),
  updateCampaignBudget: vi.fn(),
  updateCampaignStatus: vi.fn(),
  getCampaignById: vi.fn(),
  createMetaCampaign: vi.fn(),
  pauseMetaCampaign: vi.fn(),
  updateMetaCampaignBudget: vi.fn(),
  createFullGoogleCampaign: vi.fn(),
  pauseGoogleCampaign: vi.fn(),
  updateGoogleCampaignBudget: vi.fn(),
  addGoogleNegativeKeyword: vi.fn(),
}));

vi.mock("../db/proposals", () => ({ getProposalById, markProposalExecuted, markProposalFailed }));
vi.mock("../db/campaigns", () => ({
  createCampaignRecord,
  markCampaignActive,
  updateCampaignBudget,
  updateCampaignStatus,
  getCampaignById,
}));
vi.mock("../connectors/meta", () => ({ createMetaCampaign, pauseMetaCampaign, updateMetaCampaignBudget }));
vi.mock("../connectors/google-ads", () => ({
  createFullGoogleCampaign,
  pauseGoogleCampaign,
  updateGoogleCampaignBudget,
  addGoogleNegativeKeyword,
}));

import { executeProposal } from "./execute";

function approvedProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "prop-1",
    kind: "pause",
    campaignId: "camp-1",
    payload: { campaignId: "camp-1" },
    triggeredRule: "kill_rule",
    rationale: "over budget",
    status: "approved",
    error: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    decidedAt: "2026-08-03T01:00:00.000Z",
    executedAt: null,
    ...overrides,
  };
}

function googleCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "camp-1",
    platform: "google",
    externalId: "customers/1/campaigns/999",
    name: "Whitefield Search",
    status: "active",
    dailyBudget: 500,
    corridor: "whitefield",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const ORG = { kind: "org" as const, orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

beforeEach(() => vi.clearAllMocks());

describe("executeProposal", () => {
  it("throws when the proposal does not exist", async () => {
    getProposalById.mockResolvedValue(null);
    await expect(executeProposal(ORG, "missing")).rejects.toThrow("proposal missing not found");
  });

  it("throws when the proposal is not approved", async () => {
    getProposalById.mockResolvedValue(approvedProposal({ status: "pending" }));
    await expect(executeProposal(ORG, "prop-1")).rejects.toThrow("not approved");
  });

  it("pauses the correct platform campaign and marks the proposal executed", async () => {
    getProposalById.mockResolvedValue(approvedProposal());
    getCampaignById.mockResolvedValue(googleCampaign());
    pauseGoogleCampaign.mockResolvedValue(undefined);

    const result = await executeProposal(ORG, "prop-1");

    expect(pauseGoogleCampaign).toHaveBeenCalledWith("customers/1/campaigns/999");
    expect(updateCampaignStatus).toHaveBeenCalledWith(ORG, "camp-1", "paused");
    expect(markProposalExecuted).toHaveBeenCalledWith(ORG, "prop-1");
    expect(result).toEqual({ status: "executed" });
  });

  it("routes pause to the Meta connector for a meta campaign", async () => {
    getProposalById.mockResolvedValue(approvedProposal());
    getCampaignById.mockResolvedValue(googleCampaign({ platform: "meta", externalId: "ext-meta-1" }));
    pauseMetaCampaign.mockResolvedValue(undefined);

    await executeProposal(ORG, "prop-1");
    expect(pauseMetaCampaign).toHaveBeenCalledWith("ext-meta-1");
  });

  it("creates a full Google campaign, records the local row, and marks it active", async () => {
    getProposalById.mockResolvedValue(
      approvedProposal({
        kind: "create_campaign",
        campaignId: null,
        payload: {
          corridor: "whitefield",
          platform: "google",
          dailyBudgetInr: 500,
          adGroupName: "Whitefield Office Space",
          keywords: [{ text: "office space whitefield", matchType: "phrase" }],
          negativeKeywords: ["residential"],
          headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
          descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
          finalUrl: "https://www.gentlespacesolutions.com/spaces",
        },
      }),
    );
    createCampaignRecord.mockResolvedValue(googleCampaign({ status: "proposed", externalId: null }));
    createFullGoogleCampaign.mockResolvedValue("customers/1/campaigns/999");

    const result = await executeProposal(ORG, "prop-1");

    expect(createCampaignRecord).toHaveBeenCalledWith(ORG, {
      platform: "google",
      name: expect.stringContaining("whitefield"),
      dailyBudget: 500,
      corridor: "whitefield",
    });
    expect(createFullGoogleCampaign).toHaveBeenCalledWith({
      name: expect.stringContaining("whitefield"),
      dailyBudgetInr: 500,
      adGroupName: "Whitefield Office Space",
      keywords: [{ text: "office space whitefield", matchType: "phrase" }],
      negativeKeywords: ["residential"],
      headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
      descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
      finalUrl: "https://www.gentlespacesolutions.com/spaces",
    });
    expect(markCampaignActive).toHaveBeenCalledWith(ORG, "camp-1", "customers/1/campaigns/999");
    expect(result).toEqual({ status: "executed" });
  });

  it("updates budget on the correct campaign", async () => {
    getProposalById.mockResolvedValue(
      approvedProposal({
        kind: "budget_change",
        payload: { campaignId: "camp-1", newDailyBudgetInr: 600 },
      }),
    );
    getCampaignById.mockResolvedValue(googleCampaign());

    await executeProposal(ORG, "prop-1");
    expect(updateGoogleCampaignBudget).toHaveBeenCalledWith("customers/1/campaigns/999", 600);
    expect(updateCampaignBudget).toHaveBeenCalledWith(ORG, "camp-1", 600);
  });

  it("adds a negative keyword on the correct campaign", async () => {
    getProposalById.mockResolvedValue(
      approvedProposal({
        kind: "add_negative_keyword",
        payload: { campaignId: "camp-1", keywordText: "residential" },
      }),
    );
    getCampaignById.mockResolvedValue(googleCampaign());

    await executeProposal(ORG, "prop-1");
    expect(addGoogleNegativeKeyword).toHaveBeenCalledWith("customers/1/campaigns/999", "residential");
  });

  it("no-ops a campaign_strategy proposal and marks it executed without touching any connector", async () => {
    getProposalById.mockResolvedValue(
      approvedProposal({
        kind: "campaign_strategy",
        campaignId: null,
        payload: { summary: "Shift budget toward Whitefield", recommendations: [] },
      }),
    );

    const result = await executeProposal(ORG, "prop-1");

    expect(getCampaignById).not.toHaveBeenCalled();
    expect(pauseGoogleCampaign).not.toHaveBeenCalled();
    expect(markProposalExecuted).toHaveBeenCalledWith(ORG, "prop-1");
    expect(result).toEqual({ status: "executed" });
  });

  it("marks an unrecognized proposal kind as failed instead of silently executing it", async () => {
    getProposalById.mockResolvedValue(approvedProposal({ kind: "future_kind" as never }));

    const result = await executeProposal(ORG, "prop-1");

    expect(markProposalExecuted).not.toHaveBeenCalled();
    expect(markProposalFailed).toHaveBeenCalledWith(
      ORG,
      "prop-1",
      expect.stringContaining("future_kind"),
    );
    expect(result).toEqual({ status: "failed", error: expect.stringContaining("future_kind") });
  });

  it("marks the proposal failed (never retried) when the connector call throws", async () => {
    getProposalById.mockResolvedValue(approvedProposal());
    getCampaignById.mockResolvedValue(googleCampaign());
    pauseGoogleCampaign.mockRejectedValue(new Error("Google Ads API: rate limited"));

    const result = await executeProposal(ORG, "prop-1");

    expect(markProposalFailed).toHaveBeenCalledWith(ORG, "prop-1", "Google Ads API: rate limited");
    expect(markProposalExecuted).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "failed", error: "Google Ads API: rate limited" });
  });
});
