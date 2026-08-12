import {
  createCampaignRecord,
  getCampaignById,
  markCampaignActive,
  updateCampaignBudget,
  updateCampaignStatus,
} from "../db/campaigns";
import { getProposalById, markProposalExecuted, markProposalFailed } from "../db/proposals";
import type { Scope } from "../db/scope-sql";
import {
  addGoogleNegativeKeyword,
  createFullGoogleCampaign,
  pauseGoogleCampaign,
  updateGoogleCampaignBudget,
} from "../connectors/google-ads";
import { createMetaCampaign, pauseMetaCampaign, updateMetaCampaignBudget } from "../connectors/meta";
import type { Platform } from "../types";

type CreateCampaignPayload = {
  corridor: string;
  platform: Platform;
  dailyBudgetInr: number;
  adGroupName: string;
  keywords: { text: string; matchType: "broad" | "phrase" | "exact" }[];
  negativeKeywords: string[];
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
};
type CampaignActionPayload = { campaignId: string };
type BudgetChangePayload = { campaignId: string; newDailyBudgetInr: number };
type NegativeKeywordPayload = { campaignId: string; keywordText: string };

async function requireCampaign(scope: Scope, campaignId: string) {
  const campaign = await getCampaignById(scope, campaignId);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);
  if (!campaign.externalId) throw new Error(`campaign ${campaignId} has no externalId yet`);
  return campaign;
}

async function executeCreateCampaign(scope: Scope, payload: CreateCampaignPayload): Promise<void> {
  const name = `${payload.corridor} — ${payload.platform} — ${new Date().toISOString().slice(0, 10)}`;
  const record = await createCampaignRecord(scope, {
    platform: payload.platform,
    name,
    dailyBudget: payload.dailyBudgetInr,
    corridor: payload.corridor,
  });
  const externalId =
    payload.platform === "google"
      ? await createFullGoogleCampaign({
          name,
          dailyBudgetInr: payload.dailyBudgetInr,
          adGroupName: payload.adGroupName,
          keywords: payload.keywords,
          negativeKeywords: payload.negativeKeywords,
          headlines: payload.headlines,
          descriptions: payload.descriptions,
          finalUrl: payload.finalUrl,
        })
      : await createMetaCampaign({ name, dailyBudgetInr: payload.dailyBudgetInr });
  await markCampaignActive(scope, record.id, externalId);
}

async function executePause(scope: Scope, payload: CampaignActionPayload): Promise<void> {
  const campaign = await requireCampaign(scope, payload.campaignId);
  if (campaign.platform === "google") await pauseGoogleCampaign(campaign.externalId!);
  else await pauseMetaCampaign(campaign.externalId!);
  await updateCampaignStatus(scope, campaign.id, "paused");
}

async function executeBudgetChange(scope: Scope, payload: BudgetChangePayload): Promise<void> {
  const campaign = await requireCampaign(scope, payload.campaignId);
  if (campaign.platform === "google") {
    await updateGoogleCampaignBudget(campaign.externalId!, payload.newDailyBudgetInr);
  } else {
    await updateMetaCampaignBudget(campaign.externalId!, payload.newDailyBudgetInr);
  }
  await updateCampaignBudget(scope, campaign.id, payload.newDailyBudgetInr);
}

async function executeAddNegativeKeyword(scope: Scope, payload: NegativeKeywordPayload): Promise<void> {
  const campaign = await requireCampaign(scope, payload.campaignId);
  if (campaign.platform !== "google") {
    throw new Error("add_negative_keyword is only implemented for Google Ads campaigns");
  }
  await addGoogleNegativeKeyword(campaign.externalId!, payload.keywordText);
}

export async function executeProposal(
  scope: Scope,
  proposalId: string,
): Promise<{ status: "executed" | "failed"; error?: string }> {
  const proposal = await getProposalById(scope, proposalId);
  if (!proposal) throw new Error(`proposal ${proposalId} not found`);
  if (proposal.status !== "approved") {
    throw new Error(`proposal ${proposalId} is not approved (status: ${proposal.status})`);
  }

  try {
    switch (proposal.kind) {
      case "create_campaign":
        await executeCreateCampaign(scope, proposal.payload as unknown as CreateCampaignPayload);
        break;
      case "pause":
        await executePause(scope, proposal.payload as unknown as CampaignActionPayload);
        break;
      case "budget_change":
        await executeBudgetChange(scope, proposal.payload as unknown as BudgetChangePayload);
        break;
      case "add_negative_keyword":
        await executeAddNegativeKeyword(scope, proposal.payload as unknown as NegativeKeywordPayload);
        break;
      case "campaign_strategy":
        // Narrative/advisory proposal (see lib/types.ts's CampaignStrategyPayload) — nothing to
        // execute against an ad platform.
        break;
      default:
        // Defense in depth: every ProposalKind literal is handled above, so this only fires for
        // a kind the type system doesn't know about (e.g. stale data). Fail loudly instead of
        // falling through to markProposalExecuted having done nothing.
        throw new Error(`executeProposal: unhandled proposal kind "${proposal.kind}"`);
    }
    await markProposalExecuted(scope, proposalId);
    return { status: "executed" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markProposalFailed(scope, proposalId, message);
    return { status: "failed", error: message };
  }
}
