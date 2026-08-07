/**
 * Standalone Google Ads MCP server — `npm run mcp:google-ads`. Binds to localhost only; see
 * docs/superpowers/specs/2026-08-07-google-ads-mcp-integration-design.md.
 */
import { startGoogleAdsMcpServer } from "../mcp/google-ads-server/index";

startGoogleAdsMcpServer().catch((err) => {
  console.error("google-ads-mcp: failed to start", err);
  process.exit(1);
});
