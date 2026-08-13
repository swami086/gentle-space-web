/** Read-only tool names registered in mcp/google-ads-server/index.ts. */
export const GOOGLE_ADS_MCP_READ_TOOLS = [
  "list_campaign_performance",
  "search_terms_report",
  "list_accessible_customers",
] as const satisfies readonly string[];

/** Write/propose tool names registered in mcp/google-ads-server/index.ts — forbidden on S14 Hermes profiles. */
export const GOOGLE_ADS_MCP_WRITE_TOOLS = [
  "create_campaign",
  "pause_campaign",
  "update_campaign_budget",
  "add_negative_keyword",
  "propose_change",
] as const satisfies readonly string[];

const WRITE_TOOL_SET = new Set<string>(GOOGLE_ADS_MCP_WRITE_TOOLS);

export function assertGoogleAdsReadOnlyTool(name: string): void {
  if (WRITE_TOOL_SET.has(name)) throw new Error("forbidden_google_ads_write_tool");
}
