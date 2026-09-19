/**
 * Live Google Ads MCP smoke (opt-in): requires read MCP on :8766 and write MCP on :8769
 * (Compose `google-ads-mcp` + `google-ads-mcp-write`) against test-account creds in .env.local.
 *   GOOGLE_ADS_MCP_LIVE_SMOKE=1 npx vitest run mcp/google-ads-server/live-smoke.test.ts
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { callGoogleAdsTool, listGoogleAdsTools } from "../../lib/bifrost/google-ads-mcp-client";
import {
  GOOGLE_ADS_MCP_READ_TOOL_NAMES,
  GOOGLE_ADS_MCP_TOOLS,
  GOOGLE_ADS_MCP_WRITE_TOOL_NAMES,
  GOOGLE_ADS_MCP_WRITE_URL,
} from "../../lib/bifrost/google-ads-mcp-tools";

const LIVE = process.env.GOOGLE_ADS_MCP_LIVE_SMOKE === "1";

async function listToolsAt(url: string): Promise<string[]> {
  const client = new Client({ name: "ads-agent-live-smoke", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => t.name).sort();
  } finally {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
}

describe.skipIf(!LIVE)("Google Ads MCP server (live)", () => {
  it(
    "read surface exposes exactly the 3 read tools (no writes)",
    async () => {
      const tools = await listGoogleAdsTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([...GOOGLE_ADS_MCP_READ_TOOL_NAMES].sort());
      expect(names).not.toContain(GOOGLE_ADS_MCP_TOOLS.createCampaign);
      expect(tools).toHaveLength(3);
    },
    15_000,
  );

  it(
    "write surface exposes mutate tools + propose_change (no read tools)",
    async () => {
      const names = await listToolsAt(GOOGLE_ADS_MCP_WRITE_URL);
      expect(names).toEqual([...GOOGLE_ADS_MCP_WRITE_TOOL_NAMES].sort());
      expect(names).not.toContain(GOOGLE_ADS_MCP_TOOLS.listCampaignPerformance);
      expect(names).toHaveLength(5);
    },
    15_000,
  );

  it(
    "search_terms_report against the test account returns an array (rows or empty, not an error)",
    async () => {
      const rows = await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.searchTermsReport, {});
      expect(Array.isArray(rows)).toBe(true);
    },
    15_000,
  );

  it(
    "list_accessible_customers returns the configured test account's customer ID",
    async () => {
      const result = (await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.listAccessibleCustomers, {})) as {
        customerIds: string[];
      };
      expect(result.customerIds.length).toBeGreaterThan(0);
    },
    15_000,
  );
});
