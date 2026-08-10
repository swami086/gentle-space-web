/**
 * Standalone app-data MCP server — `npm run mcp:app-data`. Binds to localhost only; see
 * docs/superpowers/specs/2026-08-10-hermes-chat-integration-design.md.
 */
import { startAppDataMcpServer } from "../mcp/app-data-mcp-server/index";

startAppDataMcpServer().catch((err) => {
  console.error("app-data-mcp: failed to start", err);
  process.exit(1);
});
