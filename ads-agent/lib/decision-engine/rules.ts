import type {
  Campaign,
  CrmSignalSnapshot,
  NewProposal,
  PerformanceSnapshot,
  Platform,
} from "../types";
import type { Strategy } from "./strategy-config";

export type SearchTermRow = {
  campaignId: string;
  searchTerm: string;
  clicks: number;
  conversions: number;
};

export type RuleInput = {
  campaigns: Campaign[];
  recentSnapshots: PerformanceSnapshot[];
  recentSignals: CrmSignalSnapshot[];
  searchTerms: SearchTermRow[];
};

function killRuleProposals(campaigns: Campaign[], snapshots: PerformanceSnapshot[], strategy: Strategy): NewProposal[] {
  const threshold = strategy.breakevenCplInr * 1.4;
  const proposals: NewProposal[] = [];

  for (const campaign of campaigns) {
    if (campaign.status !== "active") continue;
    const campaignSnapshots = snapshots
      .filter((s) => s.campaignId === campaign.id)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
      .slice(0, 3);
    if (campaignSnapshots.length < 3) continue;
    const allOverThreshold = campaignSnapshots.every((s) => s.cpl !== null && s.cpl > threshold);
    if (!allOverThreshold) continue;

    proposals.push({
      kind: "pause",
      campaignId: campaign.id,
      triggeredRule: "kill_rule",
      payload: { campaignId: campaign.id, reason: `CPL exceeded ${threshold} for 3 consecutive snapshots` },
    });
  }

  return proposals;
}

function hotWarmShare(signal: CrmSignalSnapshot): number {
  const total = signal.hotCount + signal.warmCount + signal.coldCount + signal.unscoredCount;
  return total === 0 ? 0 : (signal.hotCount + signal.warmCount) / total;
}

function activeDailyBudgetSum(campaigns: Campaign[]): number {
  return campaigns
    .filter((c) => c.status === "active")
    .reduce((sum, c) => sum + (c.dailyBudget ?? 0), 0);
}

function budgetReallocationProposals(
  campaigns: Campaign[],
  signals: CrmSignalSnapshot[],
  strategy: Strategy,
): NewProposal[] {
  const perCampaignSignal = signals.filter((s) => s.campaignId !== null);
  if (perCampaignSignal.length === 0) return [];

  const shares = perCampaignSignal.map((s) => hotWarmShare(s));
  const accountAverage = shares.reduce((sum, share) => sum + share, 0) / shares.length;
  if (accountAverage === 0) return [];

  const dailyCeiling = strategy.monthlyBudgetInr / 30;
  const currentDailySum = activeDailyBudgetSum(campaigns);
  const proposals: NewProposal[] = [];

  for (const signal of perCampaignSignal) {
    const campaign = campaigns.find((c) => c.id === signal.campaignId);
    if (!campaign || campaign.status !== "active" || campaign.dailyBudget === null) continue;
    const share = hotWarmShare(signal);
    if (share < accountAverage * 2) continue;

    const increasedBudget = Math.round(campaign.dailyBudget * 1.2);
    const delta = increasedBudget - campaign.dailyBudget;
    if (currentDailySum + delta > dailyCeiling) continue;

    proposals.push({
      kind: "budget_change",
      campaignId: campaign.id,
      triggeredRule: "budget_reallocation",
      payload: { campaignId: campaign.id, newDailyBudgetInr: increasedBudget },
    });
  }

  return proposals;
}

function negativeKeywordProposals(searchTerms: SearchTermRow[], strategy: Strategy): NewProposal[] {
  const seeds = strategy.negativeKeywordSeeds.map((s) => s.toLowerCase());
  const proposals: NewProposal[] = [];

  for (const row of searchTerms) {
    if (row.clicks === 0 || row.conversions > 0) continue;
    const term = row.searchTerm.toLowerCase();
    const matchedSeed = seeds.find((seed) => term.includes(seed));
    if (!matchedSeed) continue;

    proposals.push({
      kind: "add_negative_keyword",
      campaignId: row.campaignId,
      triggeredRule: "negative_keyword",
      payload: { campaignId: row.campaignId, keywordText: matchedSeed },
    });
  }

  return proposals;
}

export function evaluateRules(input: RuleInput, strategy: Strategy): NewProposal[] {
  return [
    ...killRuleProposals(input.campaigns, input.recentSnapshots, strategy),
    ...budgetReallocationProposals(input.campaigns, input.recentSignals, strategy),
    ...negativeKeywordProposals(input.searchTerms, strategy),
  ];
}

export function proposeCampaignCreation(
  corridor: string,
  platform: Platform,
  dailyBudgetInr: number,
): NewProposal {
  return {
    kind: "create_campaign",
    campaignId: null,
    triggeredRule: "manual_campaign_creation",
    payload: { corridor, platform, dailyBudgetInr },
  };
}
