import {
  enums,
  GoogleAdsApi,
  type MutateOperation,
  ResourceNames,
  type resources,
  toMicros,
} from "google-ads-api";
import { requireEnv } from "../../lib/env";
import { createProposal } from "../../lib/db/proposals";
import type { NewProposal } from "../../lib/types";

function googleAdsClient(): GoogleAdsApi {
  return new GoogleAdsApi({
    client_id: requireEnv("GOOGLE_ADS_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_ADS_CLIENT_SECRET"),
    developer_token: requireEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
  });
}

function customer() {
  return googleAdsClient().Customer({
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
  return rows.map((row) => ({
    externalCampaignId: String(row.campaign?.id ?? ""),
    spend: Number(row.metrics?.cost_micros ?? 0) / 1_000_000,
    clicks: Number(row.metrics?.clicks ?? 0),
    impressions: Number(row.metrics?.impressions ?? 0),
    conversions: Number(row.metrics?.all_conversions ?? 0),
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
  return rows.map((row) => ({
    externalCampaignId: String(row.campaign?.id ?? ""),
    searchTerm: String(row.search_term_view?.search_term ?? ""),
    clicks: Number(row.metrics?.clicks ?? 0),
    conversions: Number(row.metrics?.conversions ?? 0),
  }));
}

/** Wraps the SDK's dedicated (non-GAQL) listAccessibleCustomers RPC — matches Google's official
 * read-only MCP server's tool of the same name. */
export async function listAccessibleCustomers(): Promise<{ customerIds: string[] }> {
  const response = await googleAdsClient().listAccessibleCustomers(requireEnv("GOOGLE_ADS_REFRESH_TOKEN"));
  const customerIds = (response.resource_names ?? []).map((name) => name.replace("customers/", ""));
  return { customerIds };
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

export type FullGoogleCampaignInput = {
  name: string;
  dailyBudgetInr: number;
  adGroupName: string;
  keywords: { text: string; matchType: "broad" | "phrase" | "exact" }[];
  negativeKeywords: string[];
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
};

const MATCH_TYPE_MAP: Record<"broad" | "phrase" | "exact", number> = {
  broad: enums.KeywordMatchType.BROAD,
  phrase: enums.KeywordMatchType.PHRASE,
  exact: enums.KeywordMatchType.EXACT,
};

export async function createFullGoogleCampaign(input: FullGoogleCampaignInput): Promise<string> {
  const cus = customer();
  const customerId = String(requireEnv("GOOGLE_ADS_CUSTOMER_ID"));
  const budgetResourceName = ResourceNames.campaignBudget(customerId, "-1");
  const campaignResourceName = ResourceNames.campaign(customerId, "-2");
  const adGroupResourceName = ResourceNames.adGroup(customerId, "-3");

  const operations: MutateOperation<
    resources.ICampaignBudget | resources.ICampaign | resources.IAdGroup | resources.IAdGroupCriterion | resources.IAdGroupAd
  >[] = [
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
        resource_name: campaignResourceName,
        name: input.name,
        advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
        status: enums.CampaignStatus.ENABLED,
        manual_cpc: { enhanced_cpc_enabled: false },
        campaign_budget: budgetResourceName,
        network_settings: { target_google_search: true, target_search_network: true },
      },
    },
    {
      entity: "ad_group",
      operation: "create",
      resource: {
        resource_name: adGroupResourceName,
        name: input.adGroupName,
        campaign: campaignResourceName,
        status: enums.AdGroupStatus.ENABLED,
        type: enums.AdGroupType.SEARCH_STANDARD,
      },
    },
    ...input.keywords.map((keyword) => ({
      entity: "ad_group_criterion" as const,
      operation: "create" as const,
      resource: {
        ad_group: adGroupResourceName,
        status: enums.AdGroupCriterionStatus.ENABLED,
        keyword: { text: keyword.text, match_type: MATCH_TYPE_MAP[keyword.matchType] },
      },
    })),
    ...input.negativeKeywords.map((text) => ({
      entity: "ad_group_criterion" as const,
      operation: "create" as const,
      resource: {
        ad_group: adGroupResourceName,
        negative: true,
        keyword: { text, match_type: enums.KeywordMatchType.BROAD },
      },
    })),
    {
      entity: "ad_group_ad",
      operation: "create",
      resource: {
        ad_group: adGroupResourceName,
        status: enums.AdGroupAdStatus.ENABLED,
        ad: {
          final_urls: [input.finalUrl],
          responsive_search_ad: {
            headlines: input.headlines.map((text) => ({ text })),
            descriptions: input.descriptions.map((text) => ({ text })),
          },
        },
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
  campaignResourceName: string,
  dailyBudgetInr: number,
): Promise<void> {
  const cus = customer();
  const rows = await cus.query(`
    SELECT campaign.campaign_budget
    FROM campaign
    WHERE campaign.resource_name = '${campaignResourceName}'
  `);
  const budgetResourceName = rows[0]?.campaign?.campaign_budget;
  if (!budgetResourceName) {
    throw new Error(`google ads: no campaign_budget for ${campaignResourceName}`);
  }
  await cus.mutateResources([
    {
      entity: "campaign_budget",
      operation: "update",
      resource: { resource_name: budgetResourceName, amount_micros: toMicros(dailyBudgetInr) },
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

/**
 * The one write surface an external agent (e.g. a future Hermes deployment) may call — never
 * touches the Google Ads or Meta APIs directly, only ever inserts a `pending` row via
 * createProposal(). Approval, rejection, and execution flow through the exact same
 * /api/proposals/[id]/approve|reject routes and executeProposal() as every other proposal.
 */
export async function proposeChange(input: NewProposal): Promise<{ proposalId: string }> {
  const proposal = await createProposal(input);
  return { proposalId: proposal.id };
}
