// ads-agent/lib/openui/resolve-tools-then-generate.ts
import { callMeteredChatCompletion } from "../metering/metered-client";
import { callTwentyTool, listTwentyTools } from "../bifrost/mcp-client";
import { callGoogleAdsTool, listGoogleAdsTools } from "../bifrost/google-ads-mcp-client";
import { twentyMcpTools } from "../bifrost/twenty-mcp-tools";
import { GOOGLE_ADS_MCP_READ_TOOL_NAMES } from "../bifrost/google-ads-mcp-tools";
import { reshapeTwentyOpportunityToolResult } from "../crm/twenty-pipeline";
import type { ChatMessage, ToolDefinition } from "../bifrost/client";
import type { MeteringContext } from "../metering/types";
import type { Scope } from "../db/scope-sql";

const MAX_ROUNDS = 2;

const GOOGLE_ADS_READ_TOOL_NAME_SET = new Set<string>(GOOGLE_ADS_MCP_READ_TOOL_NAMES);

function callReadTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  return GOOGLE_ADS_READ_TOOL_NAME_SET.has(name) ? callGoogleAdsTool(name, args) : callTwentyTool(name, args);
}

/**
 * Phase 1 of the two-phase MCP tool pattern (see
 * docs/superpowers/specs/2026-08-05-mcp-backend-tool-integration-design.md and
 * docs/superpowers/specs/2026-08-07-google-ads-mcp-integration-design.md): fetches both the Twenty
 * and Google Ads MCP servers' live tool schemas, filters each to its read-only subset, and lets the
 * model request them via a plain OpenAI-compatible `tools` param on a non-streaming Bifrost call.
 * Tool calls are executed directly against whichever MCP server owns that tool name (never through
 * Bifrost). The two servers are listed with Promise.allSettled, not Promise.all: one MCP server
 * being unreachable (e.g. Google Ads mid-rollout, before credentials exist) must not remove the
 * other's tools from the conversation — this is the same soft-fail convention cycle.ts already
 * uses per-platform. Opportunity read results are reshaped to OpenUI OpportunityCard field shape
 * before append (Google Ads results pass through unreshaped — reshapeTwentyOpportunityToolResult
 * returns non-Twenty tool results unchanged). Never throws: any failure (both MCP servers
 * unreachable, Bifrost unreachable, tool execution error) returns the input messages unchanged, so
 * the caller's Phase 2 proceeds with whatever context is available rather than failing the turn.
 */
export async function resolveToolsThenGenerate(
  ctx: MeteringContext,
  messages: ChatMessage[],
  scope: Scope,
): Promise<ChatMessage[]> {
  const allowedTwentyTools = new Set(twentyMcpTools(scope));
  const [twentyResult, googleAdsResult] = await Promise.allSettled([
    allowedTwentyTools.size > 0 ? listTwentyTools() : Promise.resolve([]),
    listGoogleAdsTools(),
  ]);
  const twentySchemas = twentyResult.status === "fulfilled" ? twentyResult.value : [];
  const googleAdsSchemas = googleAdsResult.status === "fulfilled" ? googleAdsResult.value : [];

  const readOnlyTools: ToolDefinition[] = [
    ...twentySchemas.filter((schema) => allowedTwentyTools.has(schema.name)),
    ...googleAdsSchemas.filter((schema) => (GOOGLE_ADS_MCP_READ_TOOL_NAMES as readonly string[]).includes(schema.name)),
  ].map((schema) => ({
    type: "function" as const,
    function: { name: schema.name, description: schema.description, parameters: schema.inputSchema },
  }));

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
        toolCalls.map(async (call) => {
          const raw = await callReadTool(call.function.name, JSON.parse(call.function.arguments));
          return {
            role: "tool" as const,
            content: JSON.stringify(reshapeTwentyOpportunityToolResult(call.function.name, raw)),
            tool_call_id: call.id,
          };
        }),
      );
      history = [...history, ...results];
    } catch {
      return messages;
    }
  }

  return history;
}
