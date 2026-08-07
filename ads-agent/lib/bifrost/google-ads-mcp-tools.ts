/** Streamable HTTP endpoint for the in-repo Google Ads MCP server (see
 * ads-agent/mcp/google-ads-server/, started with `npm run mcp:google-ads`). */
export const GOOGLE_ADS_MCP_URL =
  process.env.GOOGLE_ADS_MCP_URL || "http://localhost:8766/mcp";

/** Tool names exposed by mcp/google-ads-server/index.ts. */
export const GOOGLE_ADS_MCP_TOOLS = {
  listCampaignPerformance: "list_campaign_performance",
  searchTermsReport: "search_terms_report",
  listAccessibleCustomers: "list_accessible_customers",
  createCampaign: "create_campaign",
  pauseCampaign: "pause_campaign",
  updateCampaignBudget: "update_campaign_budget",
  addNegativeKeyword: "add_negative_keyword",
} as const;

/** Read-only subset the model is ever allowed to see — the 4 write tools are deliberately
 * excluded here so resolve-tools-then-generate.ts can never advertise them to the LLM. */
export const GOOGLE_ADS_MCP_READ_TOOL_NAMES = [
  GOOGLE_ADS_MCP_TOOLS.listCampaignPerformance,
  GOOGLE_ADS_MCP_TOOLS.searchTermsReport,
  GOOGLE_ADS_MCP_TOOLS.listAccessibleCustomers,
] as const;
