import { callGoogleAdsTool } from "../bifrost/google-ads-mcp-client";
import { GOOGLE_ADS_MCP_TOOLS } from "../bifrost/google-ads-mcp-tools";

export type GoogleAdsPerformanceRow = {
  externalCampaignId: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
};

export async function fetchGoogleAdsPerformance(): Promise<GoogleAdsPerformanceRow[]> {
  return (await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.listCampaignPerformance, {})) as GoogleAdsPerformanceRow[];
}

export type GoogleSearchTermRow = {
  externalCampaignId: string;
  searchTerm: string;
  clicks: number;
  conversions: number;
};

export async function fetchGoogleSearchTerms(): Promise<GoogleSearchTermRow[]> {
  return (await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.searchTermsReport, {})) as GoogleSearchTermRow[];
}

export type FullGoogleCampaignInput = {
  name: string;
  dailyBudgetInr: number;
  geoTargetConstant: string;
  languageConstant: string;
  adGroupName: string;
  keywords: { text: string; matchType: "broad" | "phrase" | "exact" }[];
  negativeKeywords: string[];
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
};

export async function createFullGoogleCampaign(input: FullGoogleCampaignInput): Promise<string> {
  const result = (await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.createCampaign, input, {
    surface: "write",
  })) as { resourceName: string };
  return result.resourceName;
}

export type GoogleShareCampaignInput = {
  name: string;
  totalBudgetMinor: number;
  geoTargetConstant: string;
  languageConstant: string;
  adGroupName: string;
  keywords: { text: string; matchType: "broad" | "phrase" | "exact" }[];
  negativeKeywords: string[];
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
};

export async function createGoogleShareCampaign(input: GoogleShareCampaignInput): Promise<number> {
  const result = (await callGoogleAdsTool("create_share_campaign", input, {
    surface: "write",
  })) as { campaignId: number };
  return result.campaignId;
}

export async function updateGoogleShareBudget(
  campaignResourceName: string,
  totalBudgetMinor: number,
): Promise<void> {
  await callGoogleAdsTool(
    "update_share_budget",
    { campaignResourceName, totalBudgetMinor },
    { surface: "write" },
  );
}

export async function pauseGoogleCampaign(campaignResourceName: string): Promise<void> {
  await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.pauseCampaign, { campaignResourceName }, { surface: "write" });
}

export async function enableGoogleShareCampaign(campaignResourceName: string): Promise<void> {
  await callGoogleAdsTool("enable_share_campaign", { campaignResourceName }, { surface: "write" });
}

export async function updateGoogleCampaignBudget(
  campaignResourceName: string,
  dailyBudgetInr: number,
): Promise<void> {
  await callGoogleAdsTool(
    GOOGLE_ADS_MCP_TOOLS.updateCampaignBudget,
    { campaignResourceName, dailyBudgetInr },
    { surface: "write" },
  );
}

export async function addGoogleNegativeKeyword(
  campaignResourceName: string,
  keywordText: string,
): Promise<void> {
  await callGoogleAdsTool(
    GOOGLE_ADS_MCP_TOOLS.addNegativeKeyword,
    { campaignResourceName, keywordText },
    { surface: "write" },
  );
}
