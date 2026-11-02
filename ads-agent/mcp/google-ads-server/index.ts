import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import {
  hostHeaderValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { z } from "zod";
import {
  addGoogleNegativeKeyword,
  createFullGoogleCampaign,
  createGoogleShareCampaign,
  fetchGoogleAdsPerformance,
  fetchGoogleSearchTerms,
  listAccessibleCustomers,
  enableGoogleShareCampaign,
  pauseGoogleCampaign,
  proposeChange,
  updateGoogleCampaignBudget,
  updateGoogleShareBudget,
} from "./tools";
import {
  type GoogleAdsMcpSurface,
  resolveGoogleAdsMcpPort,
  resolveGoogleAdsMcpSurface,
} from "./surface";

export type { GoogleAdsMcpSurface } from "./surface";
export { resolveGoogleAdsMcpPort, resolveGoogleAdsMcpSurface } from "./surface";

const MATCH_TYPES = ["broad", "phrase", "exact"] as const;

const PROPOSAL_KINDS = [
  "create_campaign",
  "pause",
  "budget_change",
  "add_negative_keyword",
  "campaign_strategy",
] as const;

/** Host-header allowlist for the DNS-rebinding guard, driven by GOOGLE_ADS_MCP_ALLOWED_HOSTS
 * (comma-separated). Defaults to localhost-only for the tsx-on-host workflow; containerized
 * deployments (docker-compose.yml, deploy/docker-compose.prod.yml) set it to include the Compose
 * service name ("google-ads-mcp") so other containers can reach this server by that name. */
export function resolveGoogleAdsMcpAllowedHosts(): string[] {
  const raw = process.env.GOOGLE_ADS_MCP_ALLOWED_HOSTS;
  if (!raw) return ["localhost", "127.0.0.1"];
  return raw
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}

/** Listen address for the HTTP server. Defaults to localhost (tsx-on-host). Compose sets
 * GOOGLE_ADS_MCP_BIND=0.0.0.0 so Docker port publish / Compose DNS can reach the process —
 * Host-header allowlist remains the DNS-rebinding guard. */
export function resolveGoogleAdsMcpBind(): string {
  const raw = process.env.GOOGLE_ADS_MCP_BIND?.trim();
  return raw && raw.length > 0 ? raw : "localhost";
}

/** Write surface refuses every request unless GOOGLE_ADS_MCP_TOKEN matches Authorization: Bearer. */
export function googleAdsWriteAuthorized(authorization: string | undefined): boolean {
  const expected = process.env.GOOGLE_ADS_MCP_TOKEN?.trim() ?? "";
  if (!expected) return false;
  const presented = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function registerReadTools(server: McpServer): void {
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
}

function registerWriteTools(server: McpServer): void {
  server.registerTool(
    "create_campaign",
    {
      description:
        "Atomically create a Google Ads Search campaign: budget, campaign, ad group, keywords, negatives, one responsive search ad",
      inputSchema: z.object({
        name: z.string(),
        dailyBudgetInr: z.number(),
        geoTargetConstant: z.string(),
        languageConstant: z.string(),
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
    "create_share_campaign",
    {
      description:
        "Atomically create a paused Google Ads Search share campaign with a total (not daily) budget, ad group, keywords, negatives, and one responsive search ad",
      inputSchema: z.object({
        name: z.string(),
        totalBudgetMinor: z.number().int(),
        geoTargetConstant: z.string(),
        languageConstant: z.string(),
        adGroupName: z.string(),
        keywords: z.array(z.object({ text: z.string(), matchType: z.enum(MATCH_TYPES) })),
        negativeKeywords: z.array(z.string()),
        headlines: z.array(z.string()),
        descriptions: z.array(z.string()),
        finalUrl: z.string(),
      }),
    },
    async (input) => ({
      content: [{ type: "text", text: JSON.stringify({ campaignId: await createGoogleShareCampaign(input) }) }],
    }),
  );

  server.registerTool(
    "update_share_budget",
    {
      description: "Update a Google Ads share campaign's total budget (minor currency units, e.g. INR paise)",
      inputSchema: z.object({ campaignResourceName: z.string(), totalBudgetMinor: z.number().int() }),
    },
    async ({ campaignResourceName, totalBudgetMinor }) => {
      await updateGoogleShareBudget(campaignResourceName, totalBudgetMinor);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
    },
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
    "enable_share_campaign",
    {
      description: "Enable a paused Google Ads share campaign",
      inputSchema: z.object({ campaignResourceName: z.string() }),
    },
    async ({ campaignResourceName }) => {
      await enableGoogleShareCampaign(campaignResourceName);
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

  server.registerTool(
    "propose_change",
    {
      description:
        "Create a pending ads-agent proposal for human review. The only tool an external agent may call to affect ads-agent — never mutates the Google Ads or Meta APIs directly.",
      inputSchema: z.object({
        kind: z.enum(PROPOSAL_KINDS),
        campaignId: z.string().nullable(),
        payload: z.record(z.string(), z.unknown()),
        triggeredRule: z.string(),
        rationale: z.string().optional(),
      }),
    },
    async (input) => ({
      content: [{ type: "text", text: JSON.stringify(await proposeChange(input)) }],
    }),
  );
}

/** Builds (but does not connect/serve) the Google Ads MCP server for the given surface.
 * Exported separately from startGoogleAdsMcpServer so tests can wire it to an in-memory transport
 * instead of a real HTTP port (see index.test.ts). */
export function buildGoogleAdsMcpServer(surface: GoogleAdsMcpSurface = resolveGoogleAdsMcpSurface()): McpServer {
  const server = new McpServer({ name: "google-ads-mcp", version: "1.0.0" });
  if (surface === "read") {
    registerReadTools(server);
  } else {
    registerWriteTools(server);
  }
  return server;
}

/**
 * Starts the Google Ads MCP server over Streamable HTTP.
 *
 * Bind address comes from GOOGLE_ADS_MCP_BIND (default localhost). Containerized
 * deployments set 0.0.0.0; Host-header allowlist (GOOGLE_ADS_MCP_ALLOWED_HOSTS) remains
 * the DNS-rebinding guard.
 *
 * Uses createMcpHandler (stateless per-request factory) instead of one long-lived
 * NodeStreamableHTTPServerTransport: our bifrost client opens a fresh MCP session for
 * every listTools/callTool via withClient(), and a single shared transport rejects the
 * second initialize with "Server already initialized".
 */
export async function startGoogleAdsMcpServer(port = resolveGoogleAdsMcpPort()): Promise<void> {
  const surface = resolveGoogleAdsMcpSurface();
  const handler = createMcpHandler(() => buildGoogleAdsMcpServer(surface));
  const nodeHandler = toNodeHandler(handler);
  const validateHost = hostHeaderValidation(resolveGoogleAdsMcpAllowedHosts());
  const validateOrigin = localhostOriginValidation();
  const bind = resolveGoogleAdsMcpBind();

  createServer((req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    if (surface === "write" && !googleAdsWriteAuthorized(req.headers.authorization)) {
      const missing = !process.env.GOOGLE_ADS_MCP_TOKEN?.trim();
      res.writeHead(missing ? 503 : 401).end(missing ? "GOOGLE_ADS_MCP_TOKEN is not set" : "unauthorized");
      return;
    }
    if (req.url !== "/mcp" && !req.url?.startsWith("/mcp?")) {
      res.writeHead(404).end();
      return;
    }
    void nodeHandler(req, res);
  }).listen(port, bind, () => {
    console.log(`google-ads-mcp (${surface}) listening on http://${bind}:${port}/mcp`);
  });
}
