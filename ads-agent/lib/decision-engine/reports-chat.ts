import { createParser } from "@openuidev/lang-core";
import { isBifrostConfigured, type ChatMessage } from "../bifrost/client";
import { streamChatCompletion } from "../openui/bifrost-stream";
import { analyticsLibrary } from "../openui/analytics-library";
import { looksLikeOpenUiLang } from "../openui/is-openui-lang";
import { parseWithBoundedRetry, type ParseAttempt } from "../openui/parse-retry";
import { callMeteredStreamingChatCompletion } from "../metering/metered-stream-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";

export type ReportsChatMessage = { role: "user" | "assistant"; content: string };
export type ReportsChatTurnEvent = { type: "delta"; content: string } | { type: "done"; reply: string };

const PLAIN_ACK_MAX_LENGTH = 120;

function buildSystemPrompt(): string {
  return analyticsLibrary.prompt({
    preamble:
      "You are the Gentle Space Reports assistant. Answer questions about campaign performance and proposals by rendering TrendChart or DataTable — pick whichever shape best matches the tool result, never force a chart onto tabular data or vice versa.",
    additionalRules: [
      "Prefer TrendChart/DataTable over plain text whenever the answer concerns metrics or tabular data.",
      "A response with no informational content (a one-word acknowledgment) may stay plain text, " +
        "under 120 characters, with no \"root = ...\" statement.",
      "No tools are registered on this route — do not use Query()/Mutation(); render components using " +
        "literal prop values drawn only from this conversation.",
      "Output only openui-lang (root = ComponentName(...)) or a short plain acknowledgment.",
    ],
  });
}

function parseReportsResponse(text: string): ParseAttempt<string> {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "error", errors: ["empty response"] };
  if (!looksLikeOpenUiLang(trimmed)) {
    if (trimmed.length <= PLAIN_ACK_MAX_LENGTH) return { kind: "ok", value: trimmed };
    return { kind: "error", errors: ["response has no component statement and is too long to treat as a plain acknowledgment"] };
  }
  const parser = createParser(analyticsLibrary.toJSONSchema());
  let result: ReturnType<typeof parser.parse>;
  try {
    result = parser.parse(trimmed);
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
  return { kind: "ok", value: trimmed };
}

async function* runReportsModel(
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

async function runReportsModelSilent(ctx: MeteringContext, messages: ChatMessage[]): Promise<string> {
  const gen = runReportsModel(ctx, messages);
  let result = await gen.next();
  while (!result.done) result = await gen.next();
  return result.value;
}

export async function* draftReportsChatReply(input: {
  history: ReportsChatMessage[];
  userMessage: string;
}): AsyncGenerator<ReportsChatTurnEvent, void, unknown> {
  if (!isBifrostConfigured()) {
    yield { type: "done", reply: "Bifrost is not configured (BIFROST_BASE_URL), so the Reports assistant can't respond yet." };
    return;
  }

  const session = await getSession();
  const ctx: MeteringContext = {
    orgId: session?.orgId ?? DEFAULT_ORG_ID,
    userId: session?.userId ?? DEFAULT_USER_ID,
    feature: "ads-agent:reports-chat",
  };

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userMessage },
  ];

  let firstRaw: string;
  try {
    firstRaw = yield* runReportsModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield { type: "done", reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits." };
      return;
    }
    yield { type: "done", reply: "The Reports assistant is unavailable right now — try again shortly." };
    return;
  }

  let attempt: ParseAttempt<string>;
  try {
    attempt = await parseWithBoundedRetry(firstRaw, parseReportsResponse, async (feedback) => {
      messages.push({ role: "assistant", content: firstRaw });
      messages.push({ role: "user", content: feedback });
      return await runReportsModelSilent(ctx, messages);
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield { type: "done", reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits." };
      return;
    }
    yield { type: "done", reply: "The Reports assistant is unavailable right now — try again shortly." };
    return;
  }

  if (attempt.kind === "error") {
    yield { type: "done", reply: "I had trouble putting that together — could you rephrase, or ask something more specific?" };
    return;
  }

  yield { type: "done", reply: attempt.value };
}
