import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  GOOGLE_ADS_MCP_URL,
  GOOGLE_ADS_MCP_WRITE_TOOL_NAMES,
  GOOGLE_ADS_MCP_WRITE_URL,
} from "./google-ads-mcp-tools";
import { parseMcpToolText, type McpToolSchema } from "./mcp-client";

export type GoogleAdsMcpCallOptions = { surface?: "read" | "write" };

function urlFor(name: string, surface?: "read" | "write"): string {
  const wantWrite = surface === "write" || GOOGLE_ADS_MCP_WRITE_TOOL_NAMES.has(name);
  if (GOOGLE_ADS_MCP_WRITE_TOOL_NAMES.has(name) && surface === "read") {
    throw new Error(`refusing to call write tool "${name}" on read surface`);
  }
  return wantWrite ? GOOGLE_ADS_MCP_WRITE_URL : GOOGLE_ADS_MCP_URL;
}

async function withClient<T>(mcpUrl: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "ads-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
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
  return withClient(GOOGLE_ADS_MCP_URL, async (client) => {
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
export async function callGoogleAdsTool(
  name: string,
  args: Record<string, unknown>,
  opts?: GoogleAdsMcpCallOptions,
): Promise<unknown> {
  const mcpUrl = urlFor(name, opts?.surface);
  return withClient(mcpUrl, async (client) => {
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
