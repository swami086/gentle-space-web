import {
  enums,
  GoogleAdsApi,
  type MutateOperation,
  ResourceNames,
  type resources,
  toMicros,
} from "google-ads-api";
import { requireEnv } from "../env";

function customer() {
  const client = new GoogleAdsApi({
    client_id: requireEnv("GOOGLE_ADS_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_ADS_CLIENT_SECRET"),
    developer_token: requireEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
  });
  return client.Customer({
    customer_id: requireEnv("GOOGLE_ADS_CUSTOMER_ID"),
    refresh_token: requireEnv("GOOGLE_ADS_REFRESH_TOKEN"),
  });
}

export type GoogleAdsPerformanceRow = {
  externalCampaignId: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
};

export async function fetchGoogleAdsPerformance(): Promise<GoogleAdsPerformanceRow[]> {
  const rows = await customer().query(`
    SELECT campaign.id, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.all_conversions
    FROM campaign
    WHERE campaign.status = "ENABLED"
    DURING LAST_3_DAYS
  `);
  return rows.map((row: Record<string, Record<string, unknown>>) => ({
    externalCampaignId: String(row.campaign.id),
    spend: Number(row.metrics.cost_micros) / 1_000_000,
    clicks: Number(row.metrics.clicks),
    impressions: Number(row.metrics.impressions),
    conversions: Number(row.metrics.all_conversions),
  }));
}

export type GoogleSearchTermRow = {
  externalCampaignId: string;
  searchTerm: string;
  clicks: number;
  conversions: number;
};

export async function fetchGoogleSearchTerms(): Promise<GoogleSearchTermRow[]> {
  const rows = await customer().query(`
    SELECT campaign.id, search_term_view.search_term, metrics.clicks, metrics.conversions
    FROM search_term_view
    WHERE metrics.clicks > 0
    DURING LAST_7_DAYS
  `);
  return rows.map((row: Record<string, Record<string, unknown>>) => ({
    externalCampaignId: String(row.campaign.id),
    searchTerm: String(row.search_term_view.search_term),
    clicks: Number(row.metrics.clicks),
    conversions: Number(row.metrics.conversions),
  }));
}

type MutateOperationResponse = { mutate_operation_responses?: Record<string, { resource_name?: string }>[] };

function extractResourceName(result: unknown, index: number): string {
  const responses = (result as MutateOperationResponse).mutate_operation_responses ?? [];
  const response = responses[index];
  const nested = response ? Object.values(response)[0] : undefined;
  if (!nested?.resource_name) {
    throw new Error(`google ads mutate: missing resource_name at operation index ${index}`);
  }
  return nested.resource_name;
}

export async function createGoogleCampaign(input: {
  name: string;
  dailyBudgetInr: number;
}): Promise<string> {
  const cus = customer();
  const budgetResourceName = ResourceNames.campaignBudget(String(requireEnv("GOOGLE_ADS_CUSTOMER_ID")), "-1");

  const operations: MutateOperation<resources.ICampaignBudget | resources.ICampaign>[] = [
    {
      entity: "campaign_budget",
      operation: "create",
      resource: {
        resource_name: budgetResourceName,
        name: `${input.name} Budget`,
        delivery_method: enums.BudgetDeliveryMethod.STANDARD,
        amount_micros: toMicros(input.dailyBudgetInr),
      },
    },
    {
      entity: "campaign",
      operation: "create",
      resource: {
        name: input.name,
        advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
        status: enums.CampaignStatus.ENABLED,
        manual_cpc: { enhanced_cpc_enabled: false },
        campaign_budget: budgetResourceName,
        network_settings: { target_google_search: true, target_search_network: true },
      },
    },
  ];

  const result = await cus.mutateResources(operations);
  return extractResourceName(result, 1);
}

export async function pauseGoogleCampaign(campaignResourceName: string): Promise<void> {
  await customer().mutateResources([
    {
      entity: "campaign",
      operation: "update",
      resource: { resource_name: campaignResourceName, status: enums.CampaignStatus.PAUSED },
    },
  ]);
}

export async function updateGoogleCampaignBudget(
  campaignBudgetResourceName: string,
  dailyBudgetInr: number,
): Promise<void> {
  await customer().mutateResources([
    {
      entity: "campaign_budget",
      operation: "update",
      resource: {
        resource_name: campaignBudgetResourceName,
        amount_micros: toMicros(dailyBudgetInr),
      },
    },
  ]);
}

export async function addGoogleNegativeKeyword(
  campaignResourceName: string,
  keywordText: string,
): Promise<void> {
  await customer().mutateResources([
    {
      entity: "campaign_criterion",
      operation: "create",
      resource: {
        campaign: campaignResourceName,
        negative: true,
        keyword: { text: keywordText, match_type: enums.KeywordMatchType.BROAD },
      },
    },
  ]);
}
