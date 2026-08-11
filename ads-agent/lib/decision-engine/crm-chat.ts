import { isBifrostConfigured, type ChatMessage } from "../bifrost/client";
import { streamChatCompletion } from "../openui/bifrost-stream";
import { crmLibrary } from "../openui/crm-library";
import { crmReadToolSpecs } from "../openui/crm-tools";
import { normalizeOpenUiResponse } from "../openui/normalize-openui-response";
import { callMeteredStreamingChatCompletion } from "../metering/metered-stream-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";

export type CrmChatMessage = { role: "user" | "assistant"; content: string };
export type CrmChatTurnEvent = { type: "delta"; content: string } | { type: "done"; reply: string };

/**
 * Official OpenUI Generate phase: describe tools + Query examples so the model wires the UI;
 * Execute happens in the client Renderer via toolProvider → /api/openui/tools → MCP on the server.
 * @see https://www.openui.com/docs/openui-lang/how-it-works
 * @see https://www.openui.com/docs/openui-lang/system-prompts
 */
function buildSystemPrompt(): string {
  return crmLibrary.prompt({
    preamble:
      "You are the Gentle Space CRM Assistant. Answer questions about leads/opportunities and, when " +
      "asked to move a lead's stage, ALWAYS render StageChangeConfirm and wait for the user's explicit " +
      "confirmation before the stage is actually changed (the confirm button calls a separate API " +
      "route, not you — you only need to render the confirmation).",
    tools: crmReadToolSpecs,
    toolExamples: [
      // Official OpenUI: object Query result + field pluck (not bare arrays — those column-pluck nulls).
      `root = OpportunityList(list.opportunities)\nlist = Query("list_opportunities", {}, {opportunities: []})`,
      `root = OpportunityList(list.opportunities)\nlist = Query("search_opportunities", {query: "Priya"}, {opportunities: []})`,
      `root = OpportunityCard(lead.name, lead.stage, lead.tier, lead.amountLabel, lead.maskedPhone, lead.source)\nlead = Query("get_opportunity", {id: "00000000-0000-0000-0000-000000000001"}, null)`,
      `root = StageChangeConfirm("00000000-0000-0000-0000-000000000001", "Office: Priya Sharma", "SHORTLIST", "TOUR")`,
    ],
    toolCalls: true,
    additionalRules: [
      "Prefer OpportunityCard/OpportunityList/StageChangeConfirm over plain text whenever the answer " +
        "concerns specific leads.",
      "A response with no informational content (a one-word acknowledgment) may stay plain text, " +
        "under 120 characters, with no \"root = ...\" statement.",
      "Always emit `root = ComponentName(...)` with positional args (Zod key order) — never named " +
        "kwargs like OpportunityCard(name: \"...\").",
      "For opportunity lists, ALWAYS use Query(\"list_opportunities\") or Query(\"search_opportunities\") " +
        "with object defaults {opportunities: []} and pass list.opportunities into OpportunityList — " +
        "never invent CRM fields as OpportunityCard positionals, and never use bare-array Query defaults.",
      "For stage moves, render StageChangeConfirm with opportunityId, opportunityName, fromStage, " +
        "toStage — never call advance_opportunity_stage yourself; the Confirm button PATCHes the stage route.",
      "Output only openui-lang (root = ComponentName(...)) or a short plain acknowledgment. No " +
        "markdown fences, no JSON, and no invented Root() wrapper (Root is not a real component).",
    ],
  });
}

async function* runCrmModel(
  ctx: MeteringContext,
  messages: ChatMessage[],
): AsyncGenerator<{ type: "delta"; content: string }, string, unknown> {
  let full = "";
  for await (const chunk of callMeteredStreamingChatCompletion(
    ctx,
    { messages, temperature: 0.3, maxTokens: 1500, timeoutMs: 20_000 },
    streamChatCompletion,
  )) {
    if (chunk.type === "delta") {
      full += chunk.content;
      yield { type: "delta", content: chunk.content };
    }
  }
  return full;
}

export async function* draftCrmChatReply(input: {
  history: CrmChatMessage[];
  userMessage: string;
}): AsyncGenerator<CrmChatTurnEvent, void, unknown> {
  if (!isBifrostConfigured()) {
    yield { type: "done", reply: "Bifrost is not configured (BIFROST_BASE_URL), so the CRM Assistant can't respond yet." };
    return;
  }

  const session = await getSession();
  const ctx: MeteringContext = {
    orgId: session?.orgId ?? DEFAULT_ORG_ID,
    userId: session?.userId ?? DEFAULT_USER_ID,
    feature: "ads-agent:crm-chat",
  };

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userMessage },
  ];

  let raw: string;
  try {
    raw = yield* runCrmModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield { type: "done", reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits." };
      return;
    }
    yield { type: "done", reply: "The CRM Assistant is unavailable right now — try again shortly." };
    return;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    yield { type: "done", reply: "I didn't get a response — try asking again." };
    return;
  }

  // Non-blocking hygiene only. Client Renderer + toolProvider executes Query() for real.
  // See docs/superpowers/specs/2026-08-05-openui-generate-execute-alignment-design.md.
  yield { type: "done", reply: normalizeOpenUiResponse(trimmed) };
}
