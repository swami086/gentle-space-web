import type { CampaignDraft, CampaignDraftFields, CampaignDraftMessage } from "../types";
import { validateDraftFields } from "./campaign-draft-rules";
import { playbookContextFor } from "./playbook-context";
import { STRATEGY } from "./strategy-config";
import { isBifrostConfigured, type ChatMessage } from "../bifrost/client";
import { streamChatCompletion } from "../openui/bifrost-stream";
import {
  buildCampaignPromptOptions,
  campaignLibrary,
  parseSetupCardResponse,
  type SetupCardProps,
} from "../openui/campaign-library";
import { callMeteredStreamingChatCompletion } from "../metering/metered-stream-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";

const PRODUCT_CONTEXT = `Gentle Space is a Bangalore commercial real estate (CRE) consultancy with an
AI-assisted space-search product. It matches a brief to office/retail/warehouse inventory and verifies
the opportunity (legal, pricing, landlord reliability) before a tour. Primary audience (~80% of ad
budget): companies seeking office/retail/warehouse space in Bangalore. Secondary audience (~20%):
property owners with space to lease. Seed corridors: ${STRATEGY.corridors.join(", ")}. Optimize copy
toward qualified leads (Hot/Warm in CRM), not raw click volume.`;

function buildSystemPrompt(): string {
  const grounding = playbookContextFor("manual_campaign_creation");
  const preamble = [
    `You help a non-technical business owner draft a real Google Search ad campaign, conversationally.
Always render a SetupCard reflecting everything you know about the draft so far — fill a subset of
fields per turn as you learn them. The first positional arg is the short conversational reply
(follow-up if something is missing/ambiguous, or a brief acknowledgment of what you just set).

CRITICAL: Never claim you wrote headlines, descriptions, keywords, or other draft fields in
the reply unless those exact values are also present in later SetupCard args — the setup
card the user sees only updates from those args, not from your prose. When the user asks you to
propose ad copy, include both headlines (3-15) and descriptions (2-4) in the same SetupCard.

Never claim you created or launched a campaign; a human always reviews and approves before anything
goes live.`,
    PRODUCT_CONTEXT,
    `Google Responsive Search Ad hard limits (non-negotiable): 3-15 headlines, each <=30 characters;
2-4 descriptions, each <=90 characters.`,
    grounding ? `Performance-marketing grounding: ${grounding}` : "",
    `Sane defaults if the user has no strong preference: daily budget around ₹${Math.round(STRATEGY.monthlyBudgetInr / 30)}, final URL https://www.gentlespacesolutions.com/spaces.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Official OpenUI PromptOptions (examples + additionalRules) — not a raw prompt concat.
  return campaignLibrary.prompt(buildCampaignPromptOptions(preamble));
}

function sanitizeReply(reply: string, props: SetupCardProps): string {
  const mentionsHeadlines = /\bheadlines?\b/i.test(reply);
  const mentionsDescriptions = /\bdescriptions?\b/i.test(reply);
  const mentionsKeywords = /\bkeywords?\b/i.test(reply);
  const mentionsAdCopy = /\bad copy\b/i.test(reply);
  const hasHeadlines = props.headlines.length > 0;
  const hasDescriptions = props.descriptions.length > 0;
  const hasKeywords = props.keywords.length > 0;

  if (mentionsHeadlines && !hasHeadlines && mentionsDescriptions && !hasDescriptions) {
    return "I haven't filled the setup card yet. Say \"propose headlines and descriptions\" and I'll put them on the right.";
  }
  if (mentionsAdCopy && !hasHeadlines && !hasDescriptions) {
    return "I haven't filled the setup card yet. Say \"propose headlines and descriptions\" and I'll put them on the right.";
  }
  if (mentionsHeadlines && !hasHeadlines) {
    return "I still need to draft headlines — say \"propose headlines\" and I'll put them on the setup card.";
  }
  if (mentionsDescriptions && !hasDescriptions) {
    return hasHeadlines
      ? "Headlines are on the setup card. Say \"propose descriptions\" and I'll add those next."
      : "I still need to draft descriptions — say \"propose descriptions\" and I'll put them on the setup card.";
  }
  if (mentionsKeywords && !hasKeywords) {
    return "I still need keywords — tell me what search terms to target and I'll add them.";
  }
  return reply;
}

type ParsedTurn =
  | { kind: "parse_error"; reply: string }
  | { kind: "ok"; reply: string; props: SetupCardProps; rawText: string };

function toFieldUpdates(props: SetupCardProps): CampaignDraftFields {
  return {
    corridor: props.corridor === "" ? null : props.corridor,
    // ponytail: OpenUI Lang can't emit positional null for numbers; 0 is the unset sentinel (invalid budget anyway)
    dailyBudgetInr: props.dailyBudgetInr === 0 ? null : props.dailyBudgetInr,
    adGroupName: props.adGroupName === "" ? null : props.adGroupName,
    keywords: props.keywords,
    headlines: props.headlines,
    descriptions: props.descriptions,
    finalUrl: props.finalUrl,
  };
}

function parseTurn(fullText: string): ParsedTurn {
  const parsed = parseSetupCardResponse(fullText);
  if (parsed.kind === "parse_error") {
    return { kind: "parse_error", reply: "I had trouble structuring that — could you rephrase?" };
  }
  const reply = sanitizeReply(
    parsed.props.assistantReply.trim() || "Updated the draft — take a look at the setup card.",
    parsed.props,
  );
  return { kind: "ok", reply, props: parsed.props, rawText: fullText };
}

/** Yields raw model text deltas; returns the final ParsedTurn once the stream ends. */
async function* runDraftModel(
  ctx: MeteringContext,
  messages: ChatMessage[],
): AsyncGenerator<{ type: "delta"; content: string }, ParsedTurn, unknown> {
  let full = "";
  for await (const chunk of callMeteredStreamingChatCompletion(
    ctx,
    { messages, temperature: 0.3, maxTokens: 2048, timeoutMs: 20_000 },
    streamChatCompletion,
  )) {
    if (chunk.type === "delta") {
      full += chunk.content;
      yield { type: "delta", content: chunk.content };
    }
  }
  return parseTurn(full);
}

/** Same as runDraftModel but drains without forwarding deltas — used for the internal
 * validation-retry and descriptions-top-up passes, exactly as those ran silently today. */
async function runDraftModelSilent(ctx: MeteringContext, messages: ChatMessage[]): Promise<ParsedTurn> {
  const gen = runDraftModel(ctx, messages);
  let result = await gen.next();
  while (!result.done) result = await gen.next();
  return result.value;
}

export type ChatTurnEvent =
  | { type: "delta"; content: string }
  | { type: "done"; reply: string; fieldUpdates: CampaignDraftFields | null; validationErrors: string[] };

function wantsAdCopy(message: string): boolean {
  return /\b(propose|assume|draft|write|headline|description|ad copy)\b/i.test(message);
}

function wantsDescriptionsOnly(message: string): boolean {
  return /\bdescriptions?\b/i.test(message) && !/\bheadlines?\b/i.test(message);
}

function buildMessages(input: { history: CampaignDraftMessage[]; userMessage: string }): ChatMessage[] {
  return [
    { role: "system", content: buildSystemPrompt() },
    ...input.history.map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
      content: m.content,
    })),
    { role: "user", content: input.userMessage },
  ];
}

function creditsExhaustedReply(): ChatTurnEvent {
  return {
    type: "done",
    reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits.",
    fieldUpdates: null,
    validationErrors: [],
  };
}

async function topUpDescriptions(
  ctx: MeteringContext,
  messages: ChatMessage[],
  headlines: string[],
  baseFields: CampaignDraftFields,
): Promise<ChatTurnEvent | null> {
  const topUpMessages: ChatMessage[] = [
    ...messages,
    {
      role: "user",
      content: `Write 2-4 Google RSA descriptions (each ≤90 chars) for these headlines: ${JSON.stringify(headlines)}.
Render a SetupCard keeping every other field exactly as it already is in this conversation — only add
descriptions.`,
    },
  ];
  try {
    let toppedUp = await runDraftModelSilent(ctx, topUpMessages);
    if (toppedUp.kind !== "ok") return null;

    let errors = validateDraftFields({ descriptions: toppedUp.props.descriptions });
    if (errors.length > 0) {
      topUpMessages.push({ role: "assistant", content: toppedUp.rawText });
      topUpMessages.push({
        role: "user",
        content: `Rejected: ${errors.join("; ")}. Render a corrected SetupCard with only descriptions changed.`,
      });
      toppedUp = await runDraftModelSilent(ctx, topUpMessages);
      if (toppedUp.kind !== "ok") return null;
      errors = validateDraftFields({ descriptions: toppedUp.props.descriptions });
      if (errors.length > 0) return null;
    }

    if (toppedUp.props.descriptions.length === 0) return null;

    const merged: CampaignDraftFields = { ...baseFields, descriptions: toppedUp.props.descriptions };
    return {
      type: "done",
      reply: sanitizeReply(toppedUp.reply, { ...toppedUp.props, ...merged }),
      fieldUpdates: merged,
      validationErrors: [],
    };
  } catch (err) {
    if (err instanceof InsufficientCreditsError) throw err;
    return null;
  }
}

export async function* draftCampaignChatReply(input: {
  draft: CampaignDraft;
  history: CampaignDraftMessage[];
  userMessage: string;
}): AsyncGenerator<ChatTurnEvent, void, unknown> {
  if (!isBifrostConfigured()) {
    yield {
      type: "done",
      reply: "Bifrost is not configured (BIFROST_BASE_URL), so I can't draft campaigns yet. Ask an admin to set it.",
      fieldUpdates: null,
      validationErrors: [],
    };
    return;
  }

  const session = await getSession();
  const ctx: MeteringContext = {
    orgId: session?.orgId ?? DEFAULT_ORG_ID,
    userId: session?.userId ?? DEFAULT_USER_ID,
    feature: "ads-agent:campaign-chat",
  };

  const messages = buildMessages(input);

  if (wantsDescriptionsOnly(input.userMessage) && input.draft.headlines.length > 0) {
    try {
      const topped = await topUpDescriptions(ctx, messages, input.draft.headlines, {});
      if (topped) {
        yield topped;
        return;
      }
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        yield creditsExhaustedReply();
        return;
      }
      throw err;
    }
  }

  let first: ParsedTurn;
  try {
    first = yield* runDraftModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield creditsExhaustedReply();
      return;
    }
    yield {
      type: "done",
      reply: "The campaign assistant is unavailable right now — try again shortly.",
      fieldUpdates: null,
      validationErrors: [],
    };
    return;
  }

  if (first.kind !== "ok") {
    yield { type: "done", reply: first.reply, fieldUpdates: null, validationErrors: [] };
    return;
  }

  const firstFieldUpdates = toFieldUpdates(first.props);
  const firstErrors = validateDraftFields(firstFieldUpdates);
  if (firstErrors.length === 0) {
    const headlines = first.props.headlines;
    const missingDescriptions = headlines.length > 0 && first.props.descriptions.length === 0;
    if (wantsAdCopy(input.userMessage) && missingDescriptions) {
      messages.push({ role: "assistant", content: first.rawText });
      try {
        const topped = await topUpDescriptions(ctx, messages, headlines, firstFieldUpdates);
        if (topped) {
          yield topped;
          return;
        }
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          yield creditsExhaustedReply();
          return;
        }
        throw err;
      }
    }
    yield { type: "done", reply: first.reply, fieldUpdates: firstFieldUpdates, validationErrors: [] };
    return;
  }

  messages.push({ role: "assistant", content: first.rawText });
  messages.push({
    role: "user",
    content: `Rejected: ${firstErrors.join("; ")}. Render a corrected SetupCard with fixed values.`,
  });

  let second: ParsedTurn;
  try {
    second = await runDraftModelSilent(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield creditsExhaustedReply();
      return;
    }
    yield {
      type: "done",
      reply: "The campaign assistant is unavailable right now — try again shortly.",
      fieldUpdates: null,
      validationErrors: firstErrors,
    };
    return;
  }

  if (second.kind !== "ok") {
    yield { type: "done", reply: second.reply, fieldUpdates: null, validationErrors: firstErrors };
    return;
  }

  const secondFieldUpdates = toFieldUpdates(second.props);
  const secondErrors = validateDraftFields(secondFieldUpdates);
  if (secondErrors.length > 0) {
    yield {
      type: "done",
      reply: `I couldn't fit that within Google's ad rules (${secondErrors.join("; ")}). Try describing it differently.`,
      fieldUpdates: null,
      validationErrors: secondErrors,
    };
    return;
  }

  yield { type: "done", reply: second.reply, fieldUpdates: secondFieldUpdates, validationErrors: [] };
}
