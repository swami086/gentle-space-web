/** Streamable HTTP endpoint for the twenty-mcp-gateway sidecar (see docker-compose.yml).
 * Default is localhost because the Next.js app runs on the host; override to
 * http://twenty-mcp-gateway:8765/mcp only when the caller is inside the Compose network. */
export const TWENTY_MCP_URL =
  process.env.TWENTY_MCP_URL || "http://localhost:8765/mcp";

/**
 * Real tool names exposed by the Twenty MCP server (github.com/mhenry3164/twenty-crm-mcp-server),
 * confirmed live against the running gateway in Task 1 Step 4 of
 * docs/superpowers/plans/2026-08-05-mcp-backend-tool-integration.md.
 */
export const TWENTY_MCP_TOOLS = {
  listOpportunities: "list_opportunities",
  getOpportunity: "get_opportunity",
  updateOpportunity: "update_opportunity",
} as const;

/**
 * Read-only subset the model is ever allowed to see (Task 6 fetches live schemas via listTools()
 * and filters to exactly these two names — updateOpportunity is deliberately excluded here so the
 * model can never be told a mutating tool exists, let alone request it).
 */
export const TWENTY_MCP_READ_TOOL_NAMES = [
  TWENTY_MCP_TOOLS.listOpportunities,
  TWENTY_MCP_TOOLS.getOpportunity,
] as const;
