/**
 * Live Google Ads MCP smoke (opt-in): requires `npm run mcp:google-ads` running locally against
 * real (test-account) credentials in .env.local.
 *   GOOGLE_ADS_MCP_LIVE_SMOKE=1 npx vitest run mcp/google-ads-server/live-smoke.test.ts
 */
import { describe, expect, it } from "vitest";
import { callGoogleAdsTool, listGoogleAdsTools } from "../../lib/bifrost/google-ads-mcp-client";
import { GOOGLE_ADS_MCP_TOOLS } from "../../lib/bifrost/google-ads-mcp-tools";

const LIVE = process.env.GOOGLE_ADS_MCP_LIVE_SMOKE === "1";

describe.skipIf(!LIVE)("Google Ads MCP server (live)", () => {
  it(
    "exposes exactly 8 tools (3 read + 5 write)",
    async () => {
      const tools = await listGoogleAdsTools();
      expect(tools.map((t) => t.name).sort()).toEqual(Object.values(GOOGLE_ADS_MCP_TOOLS).sort());
      expect(tools).toHaveLength(8);
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
