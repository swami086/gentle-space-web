import {
  createCampaignRecord,
  getCampaignById,
  markCampaignActive,
  updateCampaignBudget,
  updateCampaignStatus,
} from "../db/campaigns";
import { getProposalById, markProposalExecuted, markProposalFailed } from "../db/proposals";
import {
  addGoogleNegativeKeyword,
  createGoogleCampaign,
  pauseGoogleCampaign,
  updateGoogleCampaignBudget,
} from "../connectors/google-ads";
import { createMetaCampaign, pauseMetaCampaign, updateMetaCampaignBudget } from "../connectors/meta";
import type { Platform } from "../types";

type CreateCampaignPayload = { corridor: string; platform: Platform; dailyBudgetInr: number };
type CampaignActionPayload = { campaignId: string };
type BudgetChangePayload = { campaignId: string; newDailyBudgetInr: number };
type NegativeKeywordPayload = { campaignId: string; keywordText: string };

async function requireCampaign(campaignId: string) {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);
  if (!campaign.externalId) throw new Error(`campaign ${campaignId} has no externalId yet`);
  return campaign;
}

async function executeCreateCampaign(payload: CreateCampaignPayload): Promise<void> {
  const name = `${payload.corridor} — ${payload.platform} — ${new Date().toISOString().slice(0, 10)}`;
  const record = await createCampaignRecord({
    platform: payload.platform,
    name,
    dailyBudget: payload.dailyBudgetInr,
    corridor: payload.corridor,
  });
  const externalId =
    payload.platform === "google"
      ? await createGoogleCampaign({ name, dailyBudgetInr: payload.dailyBudgetInr })
      : await createMetaCampaign({ name, dailyBudgetInr: payload.dailyBudgetInr });
  await markCampaignActive(record.id, externalId);
}

async function executePause(payload: CampaignActionPayload): Promise<void> {
  const campaign = await requireCampaign(payload.campaignId);
  if (campaign.platform === "google") await pauseGoogleCampaign(campaign.externalId!);
  else await pauseMetaCampaign(campaign.externalId!);
  await updateCampaignStatus(campaign.id, "paused");
}

async function executeBudgetChange(payload: BudgetChangePayload): Promise<void> {
  const campaign = await requireCampaign(payload.campaignId);
  if (campaign.platform === "google") {
    await updateGoogleCampaignBudget(campaign.externalId!, payload.newDailyBudgetInr);
  } else {
    await updateMetaCampaignBudget(campaign.externalId!, payload.newDailyBudgetInr);
  }
  await updateCampaignBudget(campaign.id, payload.newDailyBudgetInr);
}

async function executeAddNegativeKeyword(payload: NegativeKeywordPayload): Promise<void> {
  const campaign = await requireCampaign(payload.campaignId);
  if (campaign.platform !== "google") {
    throw new Error("add_negative_keyword is only implemented for Google Ads campaigns");
  }
  await addGoogleNegativeKeyword(campaign.externalId!, payload.keywordText);
}

export async function executeProposal(
  proposalId: string,
): Promise<{ status: "executed" | "failed"; error?: string }> {
  const proposal = await getProposalById(proposalId);
  if (!proposal) throw new Error(`proposal ${proposalId} not found`);
  if (proposal.status !== "approved") {
    throw new Error(`proposal ${proposalId} is not approved (status: ${proposal.status})`);
  }

  try {
    switch (proposal.kind) {
      case "create_campaign":
        await executeCreateCampaign(proposal.payload as unknown as CreateCampaignPayload);
        break;
      case "pause":
        await executePause(proposal.payload as unknown as CampaignActionPayload);
        break;
      case "budget_change":
        await executeBudgetChange(proposal.payload as unknown as BudgetChangePayload);
        break;
      case "add_negative_keyword":
        await executeAddNegativeKeyword(proposal.payload as unknown as NegativeKeywordPayload);
        break;
    }
    await markProposalExecuted(proposalId);
    return { status: "executed" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markProposalFailed(proposalId, message);
    return { status: "failed", error: message };
  }
}
