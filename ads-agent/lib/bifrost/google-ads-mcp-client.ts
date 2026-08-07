import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { GOOGLE_ADS_MCP_URL } from "./google-ads-mcp-tools";
import { parseMcpToolText, type McpToolSchema } from "./mcp-client";

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "ads-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(GOOGLE_ADS_MCP_URL)));
  try {
    return await fn(client);
  } finally {
    // Streamable HTTP close can AbortError after a successful call; never let that wipe the result.
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
}

/** Live tool schemas from the Google Ads MCP server — used to build Bifrost's `tools` param. */
export async function listGoogleAdsTools(): Promise<McpToolSchema[]> {
  return withClient(async (client) => {
    const { tools } = await client.listTools();
    return tools as McpToolSchema[];
  });
}

/**
 * Calls one Google Ads MCP tool directly (no LLM, no Bifrost involved) and returns its parsed
 * content. Used both by lib/connectors/google-ads.ts's non-chat callers (cycle.ts/executor) and by
 * the chat-triggered resolve loop (resolve-tools-then-generate.ts) once a tool_call has been
 * decided by the model.
 */
export async function callGoogleAdsTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  return withClient(async (client) => {
    const result = await client.callTool({ name, arguments: args });
    const textBlock = result.content?.find(
      (block): block is { type: "text"; text: string } => block.type === "text",
    );
    const text = textBlock?.text ?? "";
    if (result.isError) {
      throw new Error(`google ads mcp tool "${name}" failed: ${text}`);
    }
    return parseMcpToolText(text);
  });
}
