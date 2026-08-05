import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { TWENTY_MCP_URL } from "./twenty-mcp-tools";

export type McpToolSchema = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "ads-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(TWENTY_MCP_URL)));
  try {
    return await fn(client);
  } finally {
    await client.close();
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
    const text = result.content?.find((block: { type: string }) => block.type === "text")?.text ?? "";
    if (result.isError) {
      throw new Error(`twenty mcp tool "${name}" failed: ${text}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  });
}
