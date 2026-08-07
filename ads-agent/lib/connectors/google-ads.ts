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
  adGroupName: string;
  keywords: { text: string; matchType: "broad" | "phrase" | "exact" }[];
  negativeKeywords: string[];
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
};

export async function createFullGoogleCampaign(input: FullGoogleCampaignInput): Promise<string> {
  const result = (await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.createCampaign, input)) as { resourceName: string };
  return result.resourceName;
}

export async function pauseGoogleCampaign(campaignResourceName: string): Promise<void> {
  await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.pauseCampaign, { campaignResourceName });
}

export async function updateGoogleCampaignBudget(
  campaignResourceName: string,
  dailyBudgetInr: number,
): Promise<void> {
  await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.updateCampaignBudget, { campaignResourceName, dailyBudgetInr });
}

export async function addGoogleNegativeKeyword(
  campaignResourceName: string,
  keywordText: string,
): Promise<void> {
  await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.addNegativeKeyword, { campaignResourceName, keywordText });
}
