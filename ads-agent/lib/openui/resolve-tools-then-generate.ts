// ads-agent/lib/openui/resolve-tools-then-generate.ts
import { callMeteredChatCompletion } from "../metering/metered-client";
import { callTwentyTool, listTwentyTools } from "../bifrost/mcp-client";
import { TWENTY_MCP_READ_TOOL_NAMES } from "../bifrost/twenty-mcp-tools";
import type { ChatMessage, ToolDefinition } from "../bifrost/client";
import type { MeteringContext } from "../metering/types";

const MAX_ROUNDS = 2;

/**
 * Phase 1 of the two-phase MCP tool pattern (see
 * docs/superpowers/specs/2026-08-05-mcp-backend-tool-integration-design.md): fetches the Twenty MCP
 * server's live tool schemas, filters to the read-only subset, and lets the model request them via
 * a plain OpenAI-compatible `tools` param on a non-streaming Bifrost call — no AI-gateway-specific
 * MCP feature involved (see the validation doc for why). Tool calls are executed directly against
 * the Twenty MCP server via lib/bifrost/mcp-client.ts, and results are appended as `tool` messages,
 * ready for the caller's existing streaming generate call. Never throws: any failure (MCP server
 * unreachable, Bifrost unreachable, tool execution error) returns the input messages unchanged, so
 * the caller's Phase 2 proceeds with whatever context is available rather than failing the turn.
 */
export async function resolveToolsThenGenerate(
  ctx: MeteringContext,
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  let readOnlyTools: ToolDefinition[];
  try {
    const liveSchemas = await listTwentyTools();
    readOnlyTools = liveSchemas
      .filter((schema) => (TWENTY_MCP_READ_TOOL_NAMES as readonly string[]).includes(schema.name))
      .map((schema) => ({
        type: "function" as const,
        function: { name: schema.name, description: schema.description, parameters: schema.inputSchema },
      }));
  } catch {
    return messages;
  }

  let history = [...messages];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let message;
    try {
      const response = await callMeteredChatCompletion(ctx, {
        messages: history,
        temperature: 0.2,
        maxTokens: 1024,
        timeoutMs: 15_000,
        tools: readOnlyTools,
      });
      message = response.choices?.[0]?.message;
    } catch {
      return messages;
    }

    // Defense in depth: even though readOnlyTools never included a mutating schema, reject any
    // tool_call name the model wasn't explicitly given — a hallucinated name is treated the same
    // as no tool calls at all for this round, not executed.
    const advertisedNames = new Set(readOnlyTools.map((t) => t.function.name));
    const toolCalls = (message?.tool_calls ?? []).filter((call) => advertisedNames.has(call.function.name));
    if (toolCalls.length === 0) break;

    history = [...history, { role: "assistant", content: message?.content ?? null, tool_calls: toolCalls }];

    try {
      const results = await Promise.all(
        toolCalls.map(async (call) => ({
          role: "tool" as const,
          content: JSON.stringify(await callTwentyTool(call.function.name, JSON.parse(call.function.arguments))),
          tool_call_id: call.id,
        })),
      );
      history = [...history, ...results];
    } catch {
      return messages;
    }
  }

  return history;
}
