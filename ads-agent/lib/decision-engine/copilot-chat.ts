import { createParser } from "@openuidev/lang-core";
import { isBifrostConfigured, type ChatMessage } from "../bifrost/client";
import { streamChatCompletion } from "../openui/bifrost-stream";
import { platformLibrary } from "../openui/platform-library";
import { platformToolSpecs } from "../openui/platform-tools";
import { looksLikeOpenUiLang } from "../openui/is-openui-lang";
import { normalizeOpenUiResponse } from "../openui/normalize-openui-response";
import { parseWithBoundedRetry, type ParseAttempt } from "../openui/parse-retry";
import { callMeteredStreamingChatCompletion } from "../metering/metered-stream-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";

export type CopilotMessage = { role: "user" | "assistant"; content: string };

export type CopilotTurnEvent = { type: "delta"; content: string } | { type: "done"; reply: string };

/** A response with no informational content (a one-word acknowledgment) stays plain text — the
 * foundation spec's Response composition rule 4. Only attempt component parsing when the text
 * looks like it's trying to emit one (a "root = Name(" statement); otherwise, treat short plain
 * text as a valid trivial acknowledgment rather than a parse failure. */
const PLAIN_ACK_MAX_LENGTH = 120;

function buildSystemPrompt(): string {
  return platformLibrary.prompt({
    preamble:
      "You are the Gentle Space admin dashboard's AI Copilot. Answer questions about campaigns, " +
      "leads, and performance by rendering the most specific matching component rather than prose.",
    tools: platformToolSpecs.filter((t) => t.name !== "advance_opportunity_stage"),
    toolExamples: [
      `root = SetupCard("Here's a Whitefield draft at ₹500/day.", "ready", "Whitefield", 500, "HSR seekers", [], ["Headline 1", "Headline 2", "Headline 3"], ["Description one."], "https://www.gentlespacesolutions.com/spaces")`,
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
      "Use Query() only with the registered tools. For stage moves, ALWAYS render StageChangeConfirm " +
        "(include opportunityId) and wait for the user to click Confirm — the Confirm button PATCHes " +
        "the stage route; do not call advance_opportunity_stage yourself.",
      "Output only openui-lang (root = ComponentName(...)) or a short plain acknowledgment. No " +
        "markdown fences, no prose outside a component statement.",
    ],
  });
}

function parseCopilotResponse(text: string): ParseAttempt<string> {
  const normalized = normalizeOpenUiResponse(text);
  if (!normalized) return { kind: "error", errors: ["empty response"] };

  if (!looksLikeOpenUiLang(normalized)) {
    if (normalized.length <= PLAIN_ACK_MAX_LENGTH) return { kind: "ok", value: normalized };
    return { kind: "error", errors: ["response has no component statement and is too long to treat as a plain acknowledgment"] };
  }

  const parser = createParser(platformLibrary.toJSONSchema());
  let result: ReturnType<typeof parser.parse>;
  try {
    result = parser.parse(normalized);
  } catch (err) {
    return { kind: "error", errors: [err instanceof Error ? err.message : "parse exception"] };
  }

  if (!result.root) {
    const meta = result.meta.errors.map((e) => `${e.path || "(root)"}: ${e.message}`);
    return { kind: "error", errors: meta.length > 0 ? meta : ["no component root parsed"] };
  }
  if (result.meta.errors.length > 0) {
    return { kind: "error", errors: result.meta.errors.map((e) => `${e.path}: ${e.message}`) };
  }
  return { kind: "ok", value: normalized };
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

async function runCopilotModelSilent(ctx: MeteringContext, messages: ChatMessage[]): Promise<string> {
  const gen = runCopilotModel(ctx, messages);
  let result = await gen.next();
  while (!result.done) result = await gen.next();
  return result.value;
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

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userMessage },
  ];

  let firstRaw: string;
  try {
    firstRaw = yield* runCopilotModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield { type: "done", reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits." };
      return;
    }
    yield { type: "done", reply: "The Copilot is unavailable right now — try again shortly." };
    return;
  }

  let attempt: ParseAttempt<string>;
  try {
    attempt = await parseWithBoundedRetry(firstRaw, parseCopilotResponse, async (feedback) => {
      messages.push({ role: "assistant", content: firstRaw });
      messages.push({ role: "user", content: feedback });
      return await runCopilotModelSilent(ctx, messages);
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield { type: "done", reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits." };
      return;
    }
    yield { type: "done", reply: "The Copilot is unavailable right now — try again shortly." };
    return;
  }

  if (attempt.kind === "error") {
    yield { type: "done", reply: "I had trouble putting that together — could you rephrase, or ask something more specific?" };
    return;
  }

  yield { type: "done", reply: attempt.value };
}
