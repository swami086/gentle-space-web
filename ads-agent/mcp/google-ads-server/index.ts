import { createServer } from "node:http";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { z } from "zod";
import {
  addGoogleNegativeKeyword,
  createFullGoogleCampaign,
  fetchGoogleAdsPerformance,
  fetchGoogleSearchTerms,
  listAccessibleCustomers,
  pauseGoogleCampaign,
  updateGoogleCampaignBudget,
} from "./tools";

const MATCH_TYPES = ["broad", "phrase", "exact"] as const;

/** Builds (but does not connect/serve) the Google Ads MCP server — 3 read tools + 4 write tools.
 * Exported separately from startGoogleAdsMcpServer so tests can wire it to an in-memory transport
 * instead of a real HTTP port (see index.test.ts). */
export function buildGoogleAdsMcpServer(): McpServer {
  const server = new McpServer({ name: "google-ads-mcp", version: "1.0.0" });

  server.registerTool(
    "list_campaign_performance",
    { description: "List last-3-day spend/clicks/impressions/conversions for enabled Google Ads campaigns" },
    async () => ({ content: [{ type: "text", text: JSON.stringify(await fetchGoogleAdsPerformance()) }] }),
  );

  server.registerTool(
    "search_terms_report",
    { description: "List last-7-day search terms with clicks/conversions across Google Ads campaigns" },
    async () => ({ content: [{ type: "text", text: JSON.stringify(await fetchGoogleSearchTerms()) }] }),
  );

  server.registerTool(
    "list_accessible_customers",
    { description: "List Google Ads customer IDs accessible to the configured refresh token" },
    async () => ({ content: [{ type: "text", text: JSON.stringify(await listAccessibleCustomers()) }] }),
  );

  server.registerTool(
    "create_campaign",
    {
      description:
        "Atomically create a Google Ads Search campaign: budget, campaign, ad group, keywords, negatives, one responsive search ad",
      inputSchema: z.object({
        name: z.string(),
        dailyBudgetInr: z.number(),
        adGroupName: z.string(),
        keywords: z.array(z.object({ text: z.string(), matchType: z.enum(MATCH_TYPES) })),
        negativeKeywords: z.array(z.string()),
        headlines: z.array(z.string()),
        descriptions: z.array(z.string()),
        finalUrl: z.string(),
      }),
    },
    async (input) => ({
      content: [{ type: "text", text: JSON.stringify({ resourceName: await createFullGoogleCampaign(input) }) }],
    }),
  );

  server.registerTool(
    "pause_campaign",
    { description: "Pause a Google Ads campaign", inputSchema: z.object({ campaignResourceName: z.string() }) },
    async ({ campaignResourceName }) => {
      await pauseGoogleCampaign(campaignResourceName);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
    },
  );

  server.registerTool(
    "update_campaign_budget",
    {
      description: "Update a Google Ads campaign's daily budget",
      inputSchema: z.object({ campaignResourceName: z.string(), dailyBudgetInr: z.number() }),
    },
    async ({ campaignResourceName, dailyBudgetInr }) => {
      await updateGoogleCampaignBudget(campaignResourceName, dailyBudgetInr);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
    },
  );

  server.registerTool(
    "add_negative_keyword",
    {
      description: "Add a campaign-level negative keyword to a Google Ads campaign",
      inputSchema: z.object({ campaignResourceName: z.string(), keywordText: z.string() }),
    },
    async ({ campaignResourceName, keywordText }) => {
      await addGoogleNegativeKeyword(campaignResourceName, keywordText);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
    },
  );

  return server;
}

/**
 * Starts the Google Ads MCP server over Streamable HTTP, bound to localhost only.
 *
 * Uses createMcpHandler (stateless per-request factory) instead of one long-lived
 * NodeStreamableHTTPServerTransport: our bifrost client opens a fresh MCP session for
 * every listTools/callTool via withClient(), and a single shared transport rejects the
 * second initialize with "Server already initialized".
 */
export async function startGoogleAdsMcpServer(port = 8766): Promise<void> {
  const handler = createMcpHandler(() => buildGoogleAdsMcpServer());
  const nodeHandler = toNodeHandler(handler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  createServer((req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    if (req.url !== "/mcp" && !req.url?.startsWith("/mcp?")) {
      res.writeHead(404).end();
      return;
    }
    void nodeHandler(req, res);
  }).listen(port, "localhost", () => {
    console.log(`google-ads-mcp listening on http://localhost:${port}/mcp`);
  });
}
