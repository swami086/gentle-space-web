import * as bizSdk from "facebook-nodejs-business-sdk";
import { requireEnv } from "../env";

const { FacebookAdsApi, AdAccount, Campaign } = bizSdk as typeof import("facebook-nodejs-business-sdk");

type RawInsightRow = {
  campaign_id: string;
  spend: string;
  clicks: string;
  impressions: string;
  actions?: { action_type: string; value: string }[];
};

export type MetaPerformanceRow = {
  externalCampaignId: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
};

function account(): InstanceType<typeof AdAccount> {
  FacebookAdsApi.init(requireEnv("META_ACCESS_TOKEN"));
  return new AdAccount(`act_${requireEnv("META_AD_ACCOUNT_ID")}`);
}

function leadConversions(actions: RawInsightRow["actions"]): number {
  const leadAction = (actions ?? []).find((a) => a.action_type === "lead");
  return leadAction ? Number(leadAction.value) : 0;
}

export async function fetchMetaPerformance(): Promise<MetaPerformanceRow[]> {
  const rows = (await account().getInsights(
    [Campaign.Fields.campaign_id, "spend", "clicks", "impressions", "actions"],
    { level: "campaign", date_preset: "last_3d" },
  )) as unknown as RawInsightRow[];

  return rows.map((row) => ({
    externalCampaignId: row.campaign_id,
    spend: Number(row.spend),
    clicks: Number(row.clicks),
    impressions: Number(row.impressions),
    conversions: leadConversions(row.actions),
  }));
}

export async function createMetaCampaign(input: {
  name: string;
  dailyBudgetInr: number;
}): Promise<string> {
  const campaign = (await account().createCampaign([], {
    [Campaign.Fields.name]: input.name,
    [Campaign.Fields.status]: Campaign.Status.active,
    [Campaign.Fields.objective]: Campaign.Objective.link_clicks,
    [Campaign.Fields.daily_budget]: Math.round(input.dailyBudgetInr * 100),
  })) as { id: string };
  return campaign.id;
}

export async function pauseMetaCampaign(externalCampaignId: string): Promise<void> {
  FacebookAdsApi.init(requireEnv("META_ACCESS_TOKEN"));
  await new Campaign(externalCampaignId).update({
    [Campaign.Fields.status]: Campaign.Status.paused,
  });
}

export async function updateMetaCampaignBudget(
  externalCampaignId: string,
  dailyBudgetInr: number,
): Promise<void> {
  FacebookAdsApi.init(requireEnv("META_ACCESS_TOKEN"));
  await new Campaign(externalCampaignId).update({
    [Campaign.Fields.daily_budget]: Math.round(dailyBudgetInr * 100),
  });
}
