import { createServer } from "node:http";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { hostHeaderValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { z } from "zod";
import { createCrmToolProvider } from "../../lib/openui/crm-tools";
import { analyticsToolProvider } from "../../lib/openui/analytics-tools";

// The app-data MCP server runs as a local developer tool with no session, so
// its tenant comes from the environment and is explicit rather than implied.
const orgId = process.env.MCP_ORG_ID;
if (!orgId) throw new Error("app-data-mcp-server: MCP_ORG_ID is required");
const crmToolProvider = createCrmToolProvider({ kind: "org", orgId });

/** Host-header allowlist for the DNS-rebinding guard, driven by APP_DATA_MCP_ALLOWED_HOSTS
 * (comma-separated). Defaults to localhost-only for the tsx-on-host workflow; docker-compose.yml
 * sets it to include the Compose service name ("app-data-mcp") so other containers can reach it. */
export function resolveAppDataMcpAllowedHosts(): string[] {
  const raw = process.env.APP_DATA_MCP_ALLOWED_HOSTS;
  if (!raw) return ["localhost", "127.0.0.1"];
  return raw
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}

/** Listen address for the HTTP server. Defaults to localhost (tsx-on-host); Compose sets
 * APP_DATA_MCP_BIND=0.0.0.0 so Docker port publish / Compose DNS can reach the process. */
export function resolveAppDataMcpBind(): string {
  const raw = process.env.APP_DATA_MCP_BIND?.trim();
  return raw && raw.length > 0 ? raw : "localhost";
}

/** Builds (but does not connect/serve) the read-only CRM + analytics MCP server — 6 read tools,
 * zero write tools. Wraps the existing crmToolProvider/analyticsToolProvider verbatim; no new
 * business logic. advance_opportunity_stage (the one CRM mutation) is intentionally not exposed —
 * propose_change on the Google Ads MCP server remains the only write path Hermes can reach. */
export function buildAppDataMcpServer(): McpServer {
  const server = new McpServer({ name: "app-data-mcp", version: "1.0.0" });

  server.registerTool(
    "list_opportunities",
    { description: "List every open CRM opportunity/lead. Returns {opportunities: OpportunityCardRow[]}." },
    async () => ({ content: [{ type: "text", text: JSON.stringify(await crmToolProvider.list_opportunities({})) }] }),
  );

  server.registerTool(
    "search_opportunities",
    {
      description: "Search CRM opportunities by case-insensitive name substring. Same {opportunities: [...]} envelope.",
      inputSchema: z.object({ query: z.string() }),
    },
    async (input) => ({
      content: [{ type: "text", text: JSON.stringify(await crmToolProvider.search_opportunities({ query: input.query })) }],
    }),
  );

  server.registerTool(
    "get_opportunity",
    {
      description: "Get one CRM opportunity by id as an OpportunityCard row, or null.",
      inputSchema: z.object({ id: z.string() }),
    },
    async (input) => ({
      content: [{ type: "text", text: JSON.stringify(await crmToolProvider.get_opportunity({ id: input.id })) }],
    }),
  );

  server.registerTool(
    "get_spend_cpl_trend",
    {
      description: "Get the daily spend/CPL trend for the last N days (default 7).",
      inputSchema: z.object({ days: z.number().optional() }),
    },
    async (input) => ({
      content: [{ type: "text", text: JSON.stringify(await analyticsToolProvider.get_spend_cpl_trend({ days: input.days })) }],
    }),
  );

  server.registerTool(
    "list_campaigns_with_cpl",
    { description: "List every campaign with its platform, status, daily budget, corridor, and latest CPL." },
    async () => ({ content: [{ type: "text", text: JSON.stringify(await analyticsToolProvider.list_campaigns_with_cpl({})) }] }),
  );

  server.registerTool(
    "list_pending_proposals",
    { description: "List every proposal currently awaiting human approval." },
    async () => ({ content: [{ type: "text", text: JSON.stringify(await analyticsToolProvider.list_pending_proposals({})) }] }),
  );

  return server;
}

/**
 * Starts the app-data MCP server over Streamable HTTP, mirroring google-ads-server/index.ts's
 * pattern exactly (createMcpHandler + host/origin validation guards).
 */
export async function startAppDataMcpServer(port = 8767): Promise<void> {
  const handler = createMcpHandler(() => buildAppDataMcpServer());
  const nodeHandler = toNodeHandler(handler);
  const validateHost = hostHeaderValidation(resolveAppDataMcpAllowedHosts());
  const validateOrigin = localhostOriginValidation();
  const bind = resolveAppDataMcpBind();

  createServer((req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    if (req.url !== "/mcp" && !req.url?.startsWith("/mcp?")) {
      res.writeHead(404).end();
      return;
    }
    void nodeHandler(req, res);
  }).listen(port, bind, () => {
    console.log(`app-data-mcp listening on http://${bind}:${port}/mcp`);
  });
}
