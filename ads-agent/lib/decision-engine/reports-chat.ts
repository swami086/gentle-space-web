import { isBifrostConfigured, type ChatMessage } from "../bifrost/client";
import { streamChatCompletion } from "../openui/bifrost-stream";
import { analyticsLibrary } from "../openui/analytics-library";
import { analyticsToolSpecs } from "../openui/analytics-tools";
import { normalizeOpenUiResponse } from "../openui/normalize-openui-response";
import { callMeteredStreamingChatCompletion } from "../metering/metered-stream-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";

export type ReportsChatMessage = { role: "user" | "assistant"; content: string };
export type ReportsChatTurnEvent = { type: "delta"; content: string } | { type: "done"; reply: string };

function buildSystemPrompt(): string {
  return analyticsLibrary.prompt({
    preamble:
      "You are the Gentle Space Reports assistant. Answer questions about campaign performance and " +
      "proposals by rendering TrendChart or DataTable — pick whichever shape best matches the tool " +
      "result, never force a chart onto tabular data or vice versa.",
    tools: analyticsToolSpecs,
    toolExamples: [
      `trend = Query("get_spend_cpl_trend", {days: 7}, [])`,
      `root = TrendChart("CPL Trend This Week", @Each(trend, "day", {label: day.date, value: day.cplInr}))`,
    ],
    additionalRules: [
      "Prefer TrendChart/DataTable over plain text whenever the answer concerns metrics or tabular data.",
      "A response with no informational content (a one-word acknowledgment) may stay plain text, " +
        "under 120 characters, with no \"root = ...\" statement.",
      "Always emit `root = ComponentName(...)` with positional args — never named kwargs, and never " +
        "wrapped in an invented Root(...) (Root is not a real component).",
      "Use Query() with the registered analytics tools. A tool's raw row field names (e.g. " +
        "date/spendInr/cplInr from get_spend_cpl_trend) do not match TrendChart's points shape " +
        "({label, value}) — reshape with @Each(rows, \"day\", {label: day.date, value: day.cplInr}) " +
        "before passing to TrendChart, exactly like the worked example above. Do not call a tool " +
        "name as a bare function — always bind it with Query() first.",
      "If tool data is unavailable, emit root = TrendChart(\"CPL trend\", []) or a short plain acknowledgment.",
    ],
  });
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

  let raw: string;
  try {
    raw = yield* runReportsModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield { type: "done", reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits." };
      return;
    }
    yield { type: "done", reply: "The Reports assistant is unavailable right now — try again shortly." };
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
