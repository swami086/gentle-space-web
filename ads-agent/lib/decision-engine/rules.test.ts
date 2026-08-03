import { describe, expect, it } from "vitest";
import type { Campaign, CrmSignalSnapshot, PerformanceSnapshot } from "../types";
import { evaluateRules, proposeCampaignCreation } from "./rules";
import type { Strategy } from "./strategy-config";

const strategy: Strategy = {
  monthlyBudgetInr: 70_000,
  audienceSplit: { tenant: 0.8, owner: 0.2 },
  optimizeFor: "hot_warm_leads",
  breakevenCplInr: 2_500,
  corridors: ["whitefield"],
  negativeKeywordSeeds: ["residential", "1bhk"],
};

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "camp-1",
    platform: "google",
    externalId: "ext-1",
    name: "Whitefield Office Search",
    status: "active",
    dailyBudget: 500,
    corridor: "whitefield",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function snapshot(overrides: Partial<PerformanceSnapshot> = {}): PerformanceSnapshot {
  return {
    id: "snap-1",
    campaignId: "camp-1",
    capturedAt: "2026-08-03T00:00:00.000Z",
    spend: 3500,
    clicks: 10,
    impressions: 100,
    conversions: 1,
    cpl: 3500,
    ...overrides,
  };
}

describe("kill rule", () => {
  it("proposes pause when CPL exceeds 1.4x breakeven for 3 consecutive snapshots", () => {
    const proposals = evaluateRules(
      {
        campaigns: [campaign()],
        recentSnapshots: [
          snapshot({ id: "s1", capturedAt: "2026-08-01T00:00:00.000Z", cpl: 3600 }),
          snapshot({ id: "s2", capturedAt: "2026-08-02T00:00:00.000Z", cpl: 3700 }),
          snapshot({ id: "s3", capturedAt: "2026-08-03T00:00:00.000Z", cpl: 3800 }),
        ],
        recentSignals: [],
        searchTerms: [],
      },
      strategy,
    );
    expect(proposals).toContainEqual(
      expect.objectContaining({ kind: "pause", campaignId: "camp-1", triggeredRule: "kill_rule" }),
    );
  });

  it("does not propose pause when only 2 of 3 recent snapshots exceed the threshold", () => {
    const proposals = evaluateRules(
      {
        campaigns: [campaign()],
        recentSnapshots: [
          snapshot({ id: "s1", capturedAt: "2026-08-01T00:00:00.000Z", cpl: 1000 }),
          snapshot({ id: "s2", capturedAt: "2026-08-02T00:00:00.000Z", cpl: 3700 }),
          snapshot({ id: "s3", capturedAt: "2026-08-03T00:00:00.000Z", cpl: 3800 }),
        ],
        recentSignals: [],
        searchTerms: [],
      },
      strategy,
    );
    expect(proposals.filter((p) => p.kind === "pause")).toHaveLength(0);
  });

  it("does not propose pause for an already-paused campaign", () => {
    const proposals = evaluateRules(
      {
        campaigns: [campaign({ status: "paused" })],
        recentSnapshots: [
          snapshot({ id: "s1", capturedAt: "2026-08-01T00:00:00.000Z", cpl: 3600 }),
          snapshot({ id: "s2", capturedAt: "2026-08-02T00:00:00.000Z", cpl: 3700 }),
          snapshot({ id: "s3", capturedAt: "2026-08-03T00:00:00.000Z", cpl: 3800 }),
        ],
        recentSignals: [],
        searchTerms: [],
      },
      strategy,
    );
    expect(proposals.filter((p) => p.kind === "pause")).toHaveLength(0);
  });
});

describe("budget reallocation rule", () => {
  function signal(campaignId: string | null, overrides: Partial<CrmSignalSnapshot> = {}): CrmSignalSnapshot {
    return {
      id: `sig-${campaignId ?? "acct"}`,
      campaignId,
      capturedAt: "2026-08-03T00:00:00.000Z",
      hotCount: 0,
      warmCount: 0,
      coldCount: 0,
      unscoredCount: 0,
      ...overrides,
    };
  }

  it("proposes a budget increase when a campaign's hot+warm share is 2x the account average", () => {
    const strong = campaign({ id: "camp-strong", dailyBudget: 300 });
    const weakA = campaign({ id: "camp-weak-a", dailyBudget: 300 });
    const weakB = campaign({ id: "camp-weak-b", dailyBudget: 300 });
    const proposals = evaluateRules(
      {
        campaigns: [strong, weakA, weakB],
        recentSnapshots: [],
        recentSignals: [
          signal("camp-strong", { hotCount: 8, warmCount: 0, coldCount: 2, unscoredCount: 0 }),
          signal("camp-weak-a", { hotCount: 1, warmCount: 0, coldCount: 9, unscoredCount: 0 }),
          signal("camp-weak-b", { hotCount: 1, warmCount: 0, coldCount: 9, unscoredCount: 0 }),
        ],
        searchTerms: [],
      },
      strategy,
    );
    expect(proposals).toContainEqual(
      expect.objectContaining({ kind: "budget_change", campaignId: "camp-strong", triggeredRule: "budget_reallocation" }),
    );
    expect(proposals.filter((p) => p.campaignId === "camp-weak-a" || p.campaignId === "camp-weak-b")).toHaveLength(0);
  });

  it("never proposes a budget increase that would breach the monthly ceiling", () => {
    const strong = campaign({ id: "camp-strong", dailyBudget: 2_300 }); // already ~69000/mo
    const weakA = campaign({ id: "camp-weak-a", dailyBudget: 10 });
    const weakB = campaign({ id: "camp-weak-b", dailyBudget: 10 });
    const proposals = evaluateRules(
      {
        campaigns: [strong, weakA, weakB],
        recentSnapshots: [],
        recentSignals: [
          signal("camp-strong", { hotCount: 8, warmCount: 0, coldCount: 2, unscoredCount: 0 }),
          signal("camp-weak-a", { hotCount: 1, warmCount: 0, coldCount: 9, unscoredCount: 0 }),
          signal("camp-weak-b", { hotCount: 1, warmCount: 0, coldCount: 9, unscoredCount: 0 }),
        ],
        searchTerms: [],
      },
      strategy,
    );
    expect(proposals.filter((p) => p.kind === "budget_change")).toHaveLength(0);
  });
});

describe("negative keyword rule", () => {
  it("proposes a negative keyword for a zero-conversion search term matching a seed pattern", () => {
    const proposals = evaluateRules(
      {
        campaigns: [campaign()],
        recentSnapshots: [],
        recentSignals: [],
        searchTerms: [
          { campaignId: "camp-1", searchTerm: "2bhk residential flat for rent", clicks: 5, conversions: 0 },
        ],
      },
      strategy,
    );
    expect(proposals).toContainEqual(
      expect.objectContaining({ kind: "add_negative_keyword", campaignId: "camp-1", triggeredRule: "negative_keyword" }),
    );
  });

  it("does not propose a negative keyword when the term converted", () => {
    const proposals = evaluateRules(
      {
        campaigns: [campaign()],
        recentSnapshots: [],
        recentSignals: [],
        searchTerms: [
          { campaignId: "camp-1", searchTerm: "residential broker office space", clicks: 5, conversions: 1 },
        ],
      },
      strategy,
    );
    expect(proposals.filter((p) => p.kind === "add_negative_keyword")).toHaveLength(0);
  });
});

describe("proposeCampaignCreation", () => {
  it("builds a create_campaign proposal and snapshots the strategy's negative-keyword seeds", () => {
    const proposal = proposeCampaignCreation(
      {
        corridor: "whitefield",
        platform: "google",
        dailyBudgetInr: 500,
        adGroupName: "Whitefield Office Space",
        keywords: [{ text: "office space whitefield", matchType: "phrase" }],
        headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
        descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
        finalUrl: "https://www.gentlespacesolutions.com/spaces",
      },
      strategy,
    );
    expect(proposal).toEqual({
      kind: "create_campaign",
      campaignId: null,
      triggeredRule: "manual_campaign_creation",
      payload: {
        corridor: "whitefield",
        platform: "google",
        dailyBudgetInr: 500,
        adGroupName: "Whitefield Office Space",
        keywords: [{ text: "office space whitefield", matchType: "phrase" }],
        negativeKeywords: ["residential", "1bhk"],
        headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
        descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
        finalUrl: "https://www.gentlespacesolutions.com/spaces",
      },
    });
  });
});
