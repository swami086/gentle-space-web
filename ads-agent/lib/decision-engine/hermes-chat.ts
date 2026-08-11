import { isHermesConfigured, streamHermesCompletion } from "../hermes/server-client";
import type { ChatMessage } from "../bifrost/client";
import { callMeteredStreamingChatCompletion } from "../metering/metered-stream-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";
import { hermesPromptLibrary } from "../openui/hermes-prompt-library";

export type HermesChatMessage = { role: "user" | "assistant"; content: string };
export type HermesChatOrigin = "copilot" | "crm" | "reports" | "campaign";
type HermesStreamDeltaEvent = { type: "delta"; content: string } | { type: "tool_progress"; tool: string };
export type HermesChatTurnEvent = HermesStreamDeltaEvent | { type: "done"; reply: string };

/**
 * Hermes already resolved its own data via MCP tool calls before writing a reply (unlike the four
 * Bifrost-backed panels, which execute Query()/Mutation() client-side) — so its OpenUI instructions
 * disable tool calls/bindings and require fully-resolved static literals instead. See
 * docs/superpowers/specs/2026-08-10-hermes-skills-and-rich-chat-design.md, Section B3.
 */
function buildHermesSystemPreamble(): string {
  return hermesPromptLibrary.prompt({
    preamble:
      "You are Hermes, a self-improving AI agent, answering from inside Gentle Space's ads-agent " +
      "admin dashboard. Ground every answer in your MCP tools — never guess at Google Ads " +
      "performance, CRM opportunities, or campaign analytics.",
    toolCalls: false,
    bindings: false,
    additionalRules: [
      "This reply is shown VERBATIM to an end user in a chat UI — it is not a scratchpad. Do NOT " +
        "narrate your plan, name the tools you called or are about to call, or describe your search " +
        "process (no \"I'm now going to...\", no step headers like \"**Finding X**\"). Do all of that " +
        "thinking silently; this reply must start directly with either the answer's `root = ...` " +
        "statement or, for plain prose, the first word of the actual answer.",
      "You already resolved your own data via MCP tool calls before writing this reply — NEVER " +
        "emit Query(...) or Mutation(...). Every value must be a static literal with the real " +
        "resolved data inlined.",
      "Always emit `root = ComponentName(...)` with positional args in Zod key order — never named " +
        'kwargs (write `TrendChart("title", [...])`, NOT `TrendChart("title", points=[...])`), and ' +
        "never invent a Root() wrapper.",
      "Use OpportunityCard/OpportunityList for CRM leads, or TrendChart/DataTable for spend or " +
        "performance data. For anything else — a plain conversational answer, an acknowledgment, or " +
        "an explanation with no CRM/analytics data to show — just answer in plain prose with no " +
        '"root = ..." statement at all.',
    ],
    examples: [
      'root = OpportunityList([{name: "Priya Sharma", stage: "SHORTLIST", tier: "HOT", amountLabel: "₹45,000/mo", maskedPhone: "98765XXXXX", source: "Website"}])',
      'root = TrendChart("Spend vs CPL — last 7 days", [{label: "Mon", value: 4200}, {label: "Tue", value: 3900}])',
      "Got it — I'll keep an eye on that campaign.",
    ],
  });
}

const SYSTEM_PREAMBLE = buildHermesSystemPreamble();

async function* runHermesModel(
  ctx: MeteringContext,
  messages: ChatMessage[],
): AsyncGenerator<HermesStreamDeltaEvent, string, unknown> {
  let full = "";
  for await (const chunk of callMeteredStreamingChatCompletion(
    ctx,
    // Gemini's own thinking tokens (agent.reasoning_effort: high in ~/.hermes/config.yaml, no
    // explicit thinkingBudget — see hermes-agent's _build_gemini_thinking_config) count against
    // this SAME max_tokens ceiling, not a separate budget. 4096 was tight enough that flash
    // models sometimes spent nearly all of it "thinking" and got cut off mid-answer (finish_
    // reason: length) right in the middle of the OpenUI-lang points array. 16000 leaves headroom
    // for both without needing to touch the shared reasoning_effort setting.
    { messages, temperature: 0.4, maxTokens: 16000, timeoutMs: 60_000 },
    streamHermesCompletion,
  )) {
    if (chunk.type === "delta") {
      full += chunk.content;
      yield { type: "delta", content: chunk.content };
    } else if (chunk.type === "tool_progress") {
      yield { type: "tool_progress", tool: chunk.tool };
    }
  }
  return full;
}

export async function* draftHermesReply(input: {
  history: HermesChatMessage[];
  userMessage: string;
  origin: HermesChatOrigin;
}): AsyncGenerator<HermesChatTurnEvent, void, unknown> {
  if (!isHermesConfigured()) {
    yield {
      type: "done",
      reply: "Hermes isn't configured yet (set HERMES_API_SERVER_URL/HERMES_API_SERVER_KEY) — ask an admin to set it.",
    };
    return;
  }

  const session = await getSession();
  const ctx: MeteringContext = {
    orgId: session?.orgId ?? DEFAULT_ORG_ID,
    userId: session?.userId ?? DEFAULT_USER_ID,
    feature: `ads-agent:hermes-chat:${input.origin}`,
  };

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PREAMBLE },
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userMessage },
  ];

  let raw: string;
  try {
    raw = yield* runHermesModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield {
        type: "done",
        reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits.",
      };
      return;
    }
    yield { type: "done", reply: "Hermes is unavailable right now — try again shortly." };
    return;
  }

  const trimmed = raw.trim();
  yield { type: "done", reply: trimmed || "I didn't get a response — try asking again." };
}
