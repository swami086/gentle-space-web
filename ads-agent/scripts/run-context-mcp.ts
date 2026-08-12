/**
 * Standalone MCP context server — `npm run mcp:context`. Connects as agent_ro
 * (AGENT_RO_DATABASE_URL), never as the owner. Binds to localhost unless
 * CONTEXT_MCP_BIND says otherwise; see
 * docs/superpowers/plans/2026-08-12-s9-s9a-mcp-context-server-tracing.md.
 */
import { startContextMcpServer } from "../mcp/context-server/index";

startContextMcpServer().catch((err) => {
  console.error("context-mcp: failed to start", err);
  process.exit(1);
});
