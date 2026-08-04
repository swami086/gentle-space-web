import type { CampaignDraft, CampaignDraftFields, CampaignDraftMessage } from "../types";
import { validateDraftFields } from "./campaign-draft-rules";
import { playbookContextFor } from "./playbook-context";
import { STRATEGY } from "./strategy-config";
import {
  firstChoiceContent,
  isBifrostConfigured,
  type ChatMessage,
} from "../bifrost/client";
import { callMeteredChatCompletion } from "../metering/metered-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";

const PRODUCT_CONTEXT = `Gentle Space is a Bangalore commercial real estate (CRE) consultancy with an
AI-assisted space-search product. It matches a brief to office/retail/warehouse inventory and verifies
the opportunity (legal, pricing, landlord reliability) before a tour. Primary audience (~80% of ad
budget): companies seeking office/retail/warehouse space in Bangalore. Secondary audience (~20%):
property owners with space to lease. Seed corridors: ${STRATEGY.corridors.join(", ")}. Optimize copy
toward qualified leads (Hot/Warm in CRM), not raw click volume.`;

const RSA_RULES = `Google Responsive Search Ad hard limits (non-negotiable): 3-15 headlines, each
<=30 characters; 2-4 descriptions, each <=90 characters.`;

function buildSystemPrompt(): string {
  const grounding = playbookContextFor("manual_campaign_creation");
  return [
    `You help a non-technical business owner draft a real Google Search ad campaign, conversationally.
Reply with a single JSON object matching the schema. Put known campaign fields into the JSON keys
as you learn them — you may fill a subset per turn. Always include assistantReply: a short
conversational message (follow-up question if something is missing/ambiguous, or a brief
acknowledgment of what you just set).

CRITICAL: Never claim you wrote headlines, descriptions, keywords, or other draft fields unless
those arrays/values are actually present in this JSON response. Copy the user sees lives on the
setup card, which only updates from the JSON fields — not from assistantReply prose. When the
user asks you to propose ad copy, include both headlines (3-15) and descriptions (2-4) in the
same JSON response.

Never claim you created or launched a campaign; a human always reviews and approves before
anything goes live.`,
    PRODUCT_CONTEXT,
    RSA_RULES,
    grounding ? `Performance-marketing grounding: ${grounding}` : "",
    `Sane defaults if the user has no strong preference: daily budget around ₹${Math.round(STRATEGY.monthlyBudgetInr / 30)}, final URL https://www.gentlespacesolutions.com/spaces.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Schema for controlled JSON generation (avoids malformed structured output). */
const DRAFT_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    assistantReply: {
      type: "string",
      description:
        "Conversational reply for the user. Do not list full headlines/descriptions here — put those in the arrays.",
    },
    headlines: {
      type: "array",
      items: { type: "string" },
      description: "3-15 items, each <=30 chars. Required when proposing ad copy.",
    },
    descriptions: {
      type: "array",
      items: { type: "string" },
      description: "2-4 items, each <=90 chars. Required when proposing ad copy — always pair with headlines.",
    },
    corridor: { type: "string", description: "Bangalore corridor/neighborhood the ad should target." },
    dailyBudgetInr: { type: "number", description: "Daily budget in INR." },
    adGroupName: { type: "string" },
    keywords: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          matchType: { type: "string", enum: ["broad", "phrase", "exact"] },
        },
        required: ["text", "matchType"],
      },
    },
    finalUrl: { type: "string" },
  },
  required: ["assistantReply"],
};

type ParsedDraftJson = CampaignDraftFields & { assistantReply?: string };

type ParsedTurn =
  | { kind: "parse_error"; reply: string }
  | { kind: "ok"; reply: string; fieldUpdates: CampaignDraftFields; rawJson: string };

function sanitizeReply(reply: string, fields: CampaignDraftFields): string {
  const mentionsHeadlines = /\bheadlines?\b/i.test(reply);
  const mentionsDescriptions = /\bdescriptions?\b/i.test(reply);
  const mentionsKeywords = /\bkeywords?\b/i.test(reply);
  const mentionsAdCopy = /\bad copy\b/i.test(reply);
  const hasHeadlines = (fields.headlines?.length ?? 0) > 0;
  const hasDescriptions = (fields.descriptions?.length ?? 0) > 0;
  const hasKeywords = (fields.keywords?.length ?? 0) > 0;

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

function parseDraftJson(responseText: string | undefined): ParsedTurn {
  if (!responseText?.trim()) {
    return { kind: "parse_error", reply: "Could you tell me more about the campaign you'd like?" };
  }
  try {
    const parsed = JSON.parse(responseText) as ParsedDraftJson;
    const { assistantReply, ...fieldUpdates } = parsed;
    let reply =
      (typeof assistantReply === "string" && assistantReply.trim()) ||
      "Updated the draft — take a look at the setup card.";
    reply = sanitizeReply(reply, fieldUpdates);
    return { kind: "ok", reply, fieldUpdates, rawJson: responseText };
  } catch {
    return { kind: "parse_error", reply: "I had trouble structuring that — could you rephrase?" };
  }
}

const DESCRIPTIONS_TOPUP_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    assistantReply: { type: "string" },
    descriptions: {
      type: "array",
      items: { type: "string" },
      description: "Exactly 2-4 Google RSA descriptions, each <=90 characters.",
    },
  },
  required: ["assistantReply", "descriptions"],
};

async function callDraftModel(
  ctx: MeteringContext,
  messages: ChatMessage[],
  schema: Record<string, unknown> = DRAFT_RESPONSE_SCHEMA,
): Promise<ParsedTurn> {
  const response = await callMeteredChatCompletion(ctx, {
    messages,
    temperature: 0.3,
    maxTokens: 2048,
    responseFormat: {
      type: "json_schema",
      json_schema: { name: "campaign_draft_reply", schema, strict: false },
    },
    timeoutMs: 20_000,
  });
  return parseDraftJson(firstChoiceContent(response));
}

export type ChatReply = { reply: string; fieldUpdates: CampaignDraftFields | null; validationErrors: string[] };

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

function creditsExhaustedReply(): ChatReply {
  return {
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
): Promise<ChatReply | null> {
  const topUpMessages: ChatMessage[] = [
    ...messages,
    {
      role: "user",
      content: `Write 2-4 Google RSA descriptions (each ≤90 chars) for these headlines: ${JSON.stringify(headlines)}. Return JSON with assistantReply and descriptions only. Do not change headlines.`,
    },
  ];
  try {
    let toppedUp = await callDraftModel(ctx, topUpMessages, DESCRIPTIONS_TOPUP_SCHEMA);
    if (toppedUp.kind !== "ok") return null;

    let errors = validateDraftFields({ descriptions: toppedUp.fieldUpdates.descriptions });
    if (errors.length > 0) {
      topUpMessages.push({ role: "assistant", content: toppedUp.rawJson });
      topUpMessages.push({
        role: "user",
        content: `Rejected: ${errors.join("; ")}. Return corrected JSON with assistantReply and descriptions only.`,
      });
      toppedUp = await callDraftModel(ctx, topUpMessages, DESCRIPTIONS_TOPUP_SCHEMA);
      if (toppedUp.kind !== "ok") return null;
      errors = validateDraftFields({ descriptions: toppedUp.fieldUpdates.descriptions });
      if (errors.length > 0) return null;
    }

    if ((toppedUp.fieldUpdates.descriptions?.length ?? 0) === 0) return null;

    const merged: CampaignDraftFields = {
      ...baseFields,
      descriptions: toppedUp.fieldUpdates.descriptions,
    };
    return {
      reply: sanitizeReply(toppedUp.reply, merged),
      fieldUpdates: merged,
      validationErrors: [],
    };
  } catch (err) {
    if (err instanceof InsufficientCreditsError) throw err;
    return null;
  }
}

export async function draftCampaignChatReply(input: {
  draft: CampaignDraft;
  history: CampaignDraftMessage[];
  userMessage: string;
}): Promise<ChatReply> {
  if (!isBifrostConfigured()) {
    return {
      reply:
        "Bifrost is not configured (BIFROST_BASE_URL), so I can't draft campaigns yet. Ask an admin to set it.",
      fieldUpdates: null,
      validationErrors: [],
    };
  }

  const session = await getSession();
  const ctx: MeteringContext = {
    orgId: session?.orgId ?? DEFAULT_ORG_ID,
    userId: session?.userId ?? DEFAULT_USER_ID,
    feature: "ads-agent:campaign-chat",
  };

  const messages = buildMessages(input);

  // If headlines already exist and the user only asked for descriptions, don't let the
  // model rewrite headlines (that was causing RSA-limit failures on follow-up turns).
  if (wantsDescriptionsOnly(input.userMessage) && input.draft.headlines.length > 0) {
    try {
      const topped = await topUpDescriptions(ctx, messages, input.draft.headlines, {});
      if (topped) return topped;
    } catch (err) {
      if (err instanceof InsufficientCreditsError) return creditsExhaustedReply();
      throw err;
    }
  }

  let first: ParsedTurn;
  try {
    first = await callDraftModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) return creditsExhaustedReply();
    return { reply: "The campaign assistant is unavailable right now — try again shortly.", fieldUpdates: null, validationErrors: [] };
  }

  if (first.kind !== "ok") {
    return { reply: first.reply, fieldUpdates: null, validationErrors: [] };
  }

  const firstErrors = validateDraftFields(first.fieldUpdates);
  if (firstErrors.length === 0) {
    const headlines = first.fieldUpdates.headlines ?? [];
    const missingDescriptions = headlines.length > 0 && (first.fieldUpdates.descriptions?.length ?? 0) === 0;
    if (wantsAdCopy(input.userMessage) && missingDescriptions) {
      messages.push({ role: "assistant", content: first.rawJson });
      try {
        const topped = await topUpDescriptions(ctx, messages, headlines, first.fieldUpdates);
        if (topped) return topped;
      } catch (err) {
        if (err instanceof InsufficientCreditsError) return creditsExhaustedReply();
        throw err;
      }
    }
    return { reply: first.reply, fieldUpdates: first.fieldUpdates, validationErrors: [] };
  }

  messages.push({ role: "assistant", content: first.rawJson });
  messages.push({
    role: "user",
    content: `Rejected: ${firstErrors.join("; ")}. Return corrected JSON with fixed values (same schema).`,
  });

  let second: ParsedTurn;
  try {
    second = await callDraftModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) return creditsExhaustedReply();
    return {
      reply: "The campaign assistant is unavailable right now — try again shortly.",
      fieldUpdates: null,
      validationErrors: firstErrors,
    };
  }

  if (second.kind !== "ok") {
    return { reply: second.reply, fieldUpdates: null, validationErrors: firstErrors };
  }

  const secondErrors = validateDraftFields(second.fieldUpdates);
  if (secondErrors.length > 0) {
    return {
      reply: `I couldn't fit that within Google's ad rules (${secondErrors.join("; ")}). Try describing it differently.`,
      fieldUpdates: null,
      validationErrors: secondErrors,
    };
  }

  return { reply: second.reply, fieldUpdates: second.fieldUpdates, validationErrors: [] };
}
