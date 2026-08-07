import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { TWENTY_MCP_URL } from "./twenty-mcp-tools";

export type McpToolSchema = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

/**
 * Twenty MCP (and similar servers) often prefix JSON with a one-line summary, e.g.
 * `Found 5 opportunities (more available)\n\n[{...}]`. Parse the first JSON value when
 * the whole text is not valid JSON.
 */
export function parseMcpToolText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[\[{]/);
    if (start >= 0) {
      try {
        return JSON.parse(trimmed.slice(start));
      } catch {
        /* fall through */
      }
    }
    return text;
  }
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "ads-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(TWENTY_MCP_URL)));
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

/** Live tool schemas from the Twenty MCP server — used to build Bifrost's `tools` param. */
export async function listTwentyTools(): Promise<McpToolSchema[]> {
  return withClient(async (client) => {
    const { tools } = await client.listTools();
    return tools as McpToolSchema[];
  });
}

/**
 * Calls one Twenty MCP tool directly (no LLM, no Bifrost involved) and returns its parsed content.
 * Used both by twenty-pipeline.ts's non-chat callers and by the chat-triggered resolve loop
 * (resolve-tools-then-generate.ts) once a tool_call has been decided by the model.
 */
export async function callTwentyTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  return withClient(async (client) => {
    const result = await client.callTool({ name, arguments: args });
    const textBlock = result.content?.find(
      (block): block is { type: "text"; text: string } => block.type === "text",
    );
    const text = textBlock?.text ?? "";
    if (result.isError) {
      throw new Error(`twenty mcp tool "${name}" failed: ${text}`);
    }
    return parseMcpToolText(text);
  });
}
