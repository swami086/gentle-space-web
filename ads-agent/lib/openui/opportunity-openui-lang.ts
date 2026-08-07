import type { ChatMessage } from "../bifrost/client";
import { TWENTY_MCP_TOOLS } from "../bifrost/twenty-mcp-tools";
import type { OpenUiOpportunityCardRow } from "../crm/twenty-pipeline";

function isOpenUiOpportunityCardRow(value: unknown): value is OpenUiOpportunityCardRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.name === "string" && typeof row.stage === "string";
}

function toolNameForCallId(messages: ChatMessage[], toolCallId: string | undefined): string | null {
  if (!toolCallId) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "assistant" || !message.tool_calls) continue;
    const match = message.tool_calls.find((call) => call.id === toolCallId);
    if (match) return match.function.name;
  }
  return null;
}

/**
 * Latest opportunity read-tool payload already reshaped for OpenUI (see
 * reshapeTwentyOpportunityToolResult). Used to emit OpportunityList/Card server-side so Phase 2
 * cannot dump fat Twenty positional args into OpportunityCard.
 */
export function latestOpportunityToolPayload(
  messages: ChatMessage[],
):
  | { kind: "list"; rows: OpenUiOpportunityCardRow[] }
  | { kind: "card"; row: OpenUiOpportunityCardRow | null }
  | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "tool" || typeof message.content !== "string") continue;
    const toolName = toolNameForCallId(messages, message.tool_call_id);
    if (!toolName) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content);
    } catch {
      continue;
    }

    if (toolName === TWENTY_MCP_TOOLS.listOpportunities) {
      const rows = Array.isArray(parsed) ? parsed.filter(isOpenUiOpportunityCardRow) : [];
      return { kind: "list", rows };
    }
    if (toolName === TWENTY_MCP_TOOLS.getOpportunity) {
      if (parsed === null) return { kind: "card", row: null };
      return { kind: "card", row: isOpenUiOpportunityCardRow(parsed) ? parsed : null };
    }
  }
  return null;
}

function openUiObjectLiteral(row: OpenUiOpportunityCardRow): string {
  return (
    `{name: ${JSON.stringify(row.name)}, stage: ${JSON.stringify(row.stage)}, ` +
    `tier: ${JSON.stringify(row.tier)}, amountLabel: ${JSON.stringify(row.amountLabel)}, ` +
    `maskedPhone: ${JSON.stringify(row.maskedPhone)}, source: ${JSON.stringify(row.source)}}`
  );
}

/** Deterministic OpenUI Lang for a list of already-reshaped opportunity rows. */
export function formatOpportunityListLang(rows: OpenUiOpportunityCardRow[]): string {
  return `root = OpportunityList([${rows.map(openUiObjectLiteral).join(", ")}])`;
}

/** Deterministic OpenUI Lang for one already-reshaped opportunity row (positional Zod order). */
export function formatOpportunityCardLang(row: OpenUiOpportunityCardRow): string {
  return (
    `root = OpportunityCard(${JSON.stringify(row.name)}, ${JSON.stringify(row.stage)}, ` +
    `${JSON.stringify(row.tier)}, ${JSON.stringify(row.amountLabel)}, ` +
    `${JSON.stringify(row.maskedPhone)}, ${JSON.stringify(row.source)})`
  );
}

/**
 * If Phase 1 produced opportunity tool rows, return the OpenUI statement to stream.
 * Otherwise null — caller should run the model.
 */
export function openUiReplyFromOpportunityTools(messages: ChatMessage[]): string | null {
  const payload = latestOpportunityToolPayload(messages);
  if (!payload) return null;
  if (payload.kind === "list") return formatOpportunityListLang(payload.rows);
  if (!payload.row) return formatOpportunityListLang([]);
  return formatOpportunityCardLang(payload.row);
}
