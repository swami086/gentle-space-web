export type Platform = "meta" | "google";
export type CampaignStatus = "proposed" | "active" | "paused" | "removed";

export type Campaign = {
  id: string;
  platform: Platform;
  externalId: string | null;
  name: string;
  status: CampaignStatus;
  dailyBudget: number | null;
  corridor: string | null;
  createdAt: string;
};

export type NewCampaign = {
  platform: Platform;
  name: string;
  dailyBudget: number | null;
  corridor: string | null;
};

export type PerformanceSnapshot = {
  id: string;
  campaignId: string;
  capturedAt: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpl: number | null;
};

export type NewPerformanceSnapshot = {
  campaignId: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  raw?: unknown;
};

export type CrmSignalSnapshot = {
  id: string;
  campaignId: string | null;
  capturedAt: string;
  hotCount: number;
  warmCount: number;
  coldCount: number;
  unscoredCount: number;
};

export type NewCrmSignalSnapshot = {
  campaignId: string | null;
  hotCount: number;
  warmCount: number;
  coldCount: number;
  unscoredCount: number;
};

export type ProposalKind = "create_campaign" | "pause" | "budget_change" | "add_negative_keyword";
export type ProposalStatus = "pending" | "approved" | "rejected" | "executed" | "failed";

export type Proposal = {
  id: string;
  kind: ProposalKind;
  campaignId: string | null;
  payload: Record<string, unknown>;
  triggeredRule: string;
  rationale: string | null;
  status: ProposalStatus;
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
  executedAt: string | null;
};

export type NewProposal = {
  kind: ProposalKind;
  campaignId: string | null;
  payload: Record<string, unknown>;
  triggeredRule: string;
  rationale?: string | null;
};

export type CronSettings = {
  enabled: boolean;
  lastRunAt: string | null;
};

export type CampaignDraftKeyword = { text: string; matchType: "broad" | "phrase" | "exact" };
export type CampaignDraftStatus = "chatting" | "ready" | "converted";

export type CampaignDraft = {
  id: string;
  status: CampaignDraftStatus;
  corridor: string | null;
  dailyBudgetInr: number | null;
  adGroupName: string | null;
  keywords: CampaignDraftKeyword[];
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
  proposalId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CampaignDraftFields = {
  corridor?: string | null;
  dailyBudgetInr?: number | null;
  adGroupName?: string | null;
  keywords?: CampaignDraftKeyword[];
  headlines?: string[];
  descriptions?: string[];
  finalUrl?: string;
};

export type CampaignDraftMessage = {
  id: string;
  draftId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};
