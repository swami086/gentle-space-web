import { isBifrostConfigured, type ChatMessage } from "../bifrost/client";
import { streamChatCompletion } from "../openui/bifrost-stream";
import { platformLibrary } from "../openui/platform-library";
import { platformToolSpecs } from "../openui/platform-tools";
import { normalizeOpenUiResponse } from "../openui/normalize-openui-response";
import { resolveToolsThenGenerate } from "../openui/resolve-tools-then-generate";
import { callMeteredStreamingChatCompletion } from "../metering/metered-stream-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";

export type CopilotMessage = { role: "user" | "assistant"; content: string };

export type CopilotTurnEvent = { type: "delta"; content: string } | { type: "done"; reply: string };

function buildSystemPrompt(): string {
  return platformLibrary.prompt({
    preamble:
      "You are the Gentle Space admin dashboard's AI Copilot. Answer questions about campaigns, " +
      "leads, and performance by rendering the most specific matching component rather than prose.",
    tools: platformToolSpecs.filter(
      (t) => !["advance_opportunity_stage", "list_opportunities", "get_opportunity", "search_opportunities"].includes(t.name),
    ),
    toolExamples: [
      `root = SetupCard("Here's a Whitefield draft at ₹500/day.", "ready", "Whitefield", 500, "HSR seekers", [], ["Headline 1", "Headline 2", "Headline 3"], ["Description one."], "https://www.gentlespacesolutions.com/spaces")`,
      `root = OpportunityList([{name: "Office: Priya Sharma", stage: "SHORTLIST", tier: "HOT", amountLabel: "15000", maskedPhone: "+91 8XXXXX-1234", source: "WhatsApp"}])`,
    ],
    additionalRules: [
      "Prefer rendering the most specific matching component over plain text — component > prose, " +
        "always, unless the response carries no information at all.",
      "A response with no informational content (a one-word acknowledgment like \"Done\" or " +
        "\"Cancelled\" after a confirmed action) may stay plain text, under 120 characters, with no " +
        "\"root = ...\" statement at all — do not force a trivial ack into a component.",
      "Always emit openui-lang as `root = ComponentName(...)` with POSITIONAL args (Zod key order). " +
        "Never use named kwargs like SetupCard(status: \"ready\").",
      "When the user asks to create, start, or sample a campaign: call Mutation(\"start_campaign_draft\", {}) " +
        "and reply with a short plain acknowledgment under 120 characters that includes the returned path " +
        "(e.g. Draft ready — open /campaigns/drafts/<id>). Do not invent a full SetupCard for creation; " +
        "Campaign Chat on that draft page owns setup.",
      "CRM opportunity/lead data (if relevant to this question) is already provided to you above as a " +
        "tool result — build OpportunityList/OpportunityCard directly from that data, reshaping each " +
        "row into the component's exact prop names (see the worked example). Do not call Query() for " +
        "opportunity data; it is not fetched that way anymore.",
      "For stage moves, ALWAYS render StageChangeConfirm (include opportunityId) and wait for the " +
        "user to click Confirm — the Confirm button PATCHes the stage route; do not call " +
        "advance_opportunity_stage yourself. Use Query() only for start_campaign_draft's Mutation() " +
        "and the analytics tools (get_spend_cpl_trend, list_campaigns_with_cpl, list_pending_proposals).",
      "Output only openui-lang (root = ComponentName(...)) or a short plain acknowledgment. No " +
        "markdown fences, no JSON, no invented Root() wrapper or macros, no prose outside a component statement.",
    ],
  });
}

async function* runCopilotModel(
  ctx: MeteringContext,
  messages: ChatMessage[],
): AsyncGenerator<{ type: "delta"; content: string }, string, unknown> {
  let full = "";
  for await (const chunk of callMeteredStreamingChatCompletion(
    ctx,
    { messages, temperature: 0.4, maxTokens: 2048, timeoutMs: 20_000 },
    streamChatCompletion,
  )) {
    if (chunk.type === "delta") {
      full += chunk.content;
      yield { type: "delta", content: chunk.content };
    }
  }
  return full;
}

export async function* draftCopilotReply(input: {
  history: CopilotMessage[];
  userMessage: string;
}): AsyncGenerator<CopilotTurnEvent, void, unknown> {
  if (!isBifrostConfigured()) {
    yield { type: "done", reply: "Bifrost is not configured (BIFROST_BASE_URL), so the Copilot can't respond yet. Ask an admin to set it." };
    return;
  }

  const session = await getSession();
  const ctx: MeteringContext = {
    orgId: session?.orgId ?? DEFAULT_ORG_ID,
    userId: session?.userId ?? DEFAULT_USER_ID,
    feature: "ads-agent:copilot-chat",
  };

  const baseMessages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userMessage },
  ];
  const messages = await resolveToolsThenGenerate(ctx, baseMessages);

  let raw: string;
  try {
    raw = yield* runCopilotModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield { type: "done", reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits." };
      return;
    }
    yield { type: "done", reply: "The Copilot is unavailable right now — try again shortly." };
    return;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    yield { type: "done", reply: "I didn't get a response — try asking again." };
    return;
  }

  // Non-blocking hygiene only. Never rejects or retries — the client Renderer (with its
  // toolProvider) parses and executes Query()/Mutation() for real. See
  // docs/superpowers/specs/2026-08-05-openui-generate-execute-alignment-design.md.
  yield { type: "done", reply: normalizeOpenUiResponse(trimmed) };
}
