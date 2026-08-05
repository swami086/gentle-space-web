import { createParser } from "@openuidev/lang-core";
import { isBifrostConfigured, type ChatMessage } from "../bifrost/client";
import { streamChatCompletion } from "../openui/bifrost-stream";
import { crmLibrary } from "../openui/crm-library";
import { looksLikeOpenUiLang } from "../openui/is-openui-lang";
import { parseWithBoundedRetry, type ParseAttempt } from "../openui/parse-retry";
import { callMeteredStreamingChatCompletion } from "../metering/metered-stream-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";

export type CrmChatMessage = { role: "user" | "assistant"; content: string };
export type CrmChatTurnEvent = { type: "delta"; content: string } | { type: "done"; reply: string };

const PLAIN_ACK_MAX_LENGTH = 120;

function buildSystemPrompt(): string {
  return crmLibrary.prompt({
    preamble:
      "You are the Gentle Space CRM Assistant. Answer questions about leads/opportunities and, when " +
      "asked to move a lead's stage, ALWAYS render StageChangeConfirm and wait for the user's explicit " +
      "confirmation before the stage is actually changed (the confirm button calls a separate API " +
      "route, not you — you only need to render the confirmation).",
    additionalRules: [
      "Prefer OpportunityCard/OpportunityList/StageChangeConfirm over plain text whenever the answer " +
        "concerns specific leads.",
      "A response with no informational content (a one-word acknowledgment) may stay plain text, " +
        "under 120 characters, with no \"root = ...\" statement.",
      "No tools are registered on this route — do not use Query()/Mutation(); render components using " +
        "literal prop values drawn only from this conversation.",
      "Output only openui-lang (root = ComponentName(...)) or a short plain acknowledgment.",
    ],
  });
}

function parseCrmResponse(text: string): ParseAttempt<string> {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "error", errors: ["empty response"] };
  if (!looksLikeOpenUiLang(trimmed)) {
    if (trimmed.length <= PLAIN_ACK_MAX_LENGTH) return { kind: "ok", value: trimmed };
    return { kind: "error", errors: ["response has no component statement and is too long to treat as a plain acknowledgment"] };
  }
  const parser = createParser(crmLibrary.toJSONSchema());
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

async function runCrmModelSilent(ctx: MeteringContext, messages: ChatMessage[]): Promise<string> {
  const gen = runCrmModel(ctx, messages);
  let result = await gen.next();
  while (!result.done) result = await gen.next();
  return result.value;
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

  let firstRaw: string;
  try {
    firstRaw = yield* runCrmModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield { type: "done", reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits." };
      return;
    }
    yield { type: "done", reply: "The CRM Assistant is unavailable right now — try again shortly." };
    return;
  }

  let attempt: ParseAttempt<string>;
  try {
    attempt = await parseWithBoundedRetry(firstRaw, parseCrmResponse, async (feedback) => {
      messages.push({ role: "assistant", content: firstRaw });
      messages.push({ role: "user", content: feedback });
      return await runCrmModelSilent(ctx, messages);
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield { type: "done", reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits." };
      return;
    }
    yield { type: "done", reply: "The CRM Assistant is unavailable right now — try again shortly." };
    return;
  }

  if (attempt.kind === "error") {
    yield { type: "done", reply: "I had trouble putting that together — could you rephrase, or name the lead more specifically?" };
    return;
  }

  yield { type: "done", reply: attempt.value };
}
