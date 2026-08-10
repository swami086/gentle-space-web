import { isHermesConfigured, streamHermesCompletion } from "../hermes/server-client";
import type { ChatMessage } from "../bifrost/client";
import { callMeteredStreamingChatCompletion } from "../metering/metered-stream-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";

export type HermesChatMessage = { role: "user" | "assistant"; content: string };
export type HermesChatOrigin = "copilot" | "crm" | "reports" | "campaign";
export type HermesChatTurnEvent = { type: "delta"; content: string } | { type: "done"; reply: string };

const SYSTEM_PREAMBLE =
  "You are Hermes, a self-improving AI agent, answering from inside Gentle Space's ads-agent admin " +
  "dashboard. Reply in plain prose — never emit OpenUI-lang or any other UI-description syntax. Use " +
  "your MCP tools to ground answers about Google Ads performance, CRM opportunities, and campaign " +
  "analytics in real data rather than guessing.";

async function* runHermesModel(
  ctx: MeteringContext,
  messages: ChatMessage[],
): AsyncGenerator<{ type: "delta"; content: string }, string, unknown> {
  let full = "";
  for await (const chunk of callMeteredStreamingChatCompletion(
    ctx,
    { messages, temperature: 0.4, maxTokens: 4096, timeoutMs: 60_000 },
    streamHermesCompletion,
  )) {
    if (chunk.type === "delta") {
      full += chunk.content;
      yield { type: "delta", content: chunk.content };
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
