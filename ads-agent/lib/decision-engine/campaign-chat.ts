import type { CampaignDraft, CampaignDraftFields, CampaignDraftMessage } from "../types";
import { validateDraftFields } from "./campaign-draft-rules";
import { playbookContextFor } from "./playbook-context";
import { STRATEGY } from "./strategy-config";

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
Ask a short follow-up question if a required field is missing or ambiguous. Once you have enough
information for a field, call the update_campaign_draft tool with just that field — you may call it
multiple times across the conversation as you learn more. Never claim you created or launched a
campaign; a human always reviews and approves before anything goes live.`,
    PRODUCT_CONTEXT,
    RSA_RULES,
    grounding ? `Performance-marketing grounding: ${grounding}` : "",
    `Sane defaults if the user has no strong preference: daily budget around ₹${Math.round(STRATEGY.monthlyBudgetInr / 30)}, final URL https://www.gentlespacesolutions.com/spaces.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const UPDATE_DRAFT_TOOL = {
  type: "function" as const,
  function: {
    name: "update_campaign_draft",
    description: "Write any subset of the campaign draft's fields as they become known.",
    parameters: {
      type: "object",
      properties: {
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
        headlines: { type: "array", items: { type: "string" }, description: "3-15 items, each <=30 chars" },
        descriptions: { type: "array", items: { type: "string" }, description: "2-4 items, each <=90 chars" },
        finalUrl: { type: "string" },
      },
    },
  },
};

type OpenAiToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type OpenAiMessage = { content?: string | null; tool_calls?: OpenAiToolCall[] };
type OpenAiChatResponse = { choices: { message?: OpenAiMessage }[] };

async function callOpenAi(
  apiKey: string,
  messages: Record<string, unknown>[],
): Promise<OpenAiChatResponse | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 600,
        messages,
        tools: [UPDATE_DRAFT_TOOL],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as OpenAiChatResponse;
  } catch {
    return null;
  }
}

type ParsedToolCall =
  | { kind: "no_tool_call"; reply: string }
  | { kind: "parse_error"; reply: string }
  | {
      kind: "tool_call";
      reply: string;
      fieldUpdates: CampaignDraftFields;
      assistantMessage: OpenAiMessage;
      toolCallId: string;
    };

function parseToolCall(response: OpenAiChatResponse): ParsedToolCall {
  const message = response.choices[0]?.message;
  const toolCall = message?.tool_calls?.find((call) => call.function.name === "update_campaign_draft");
  if (!message || !toolCall) {
    return {
      kind: "no_tool_call",
      reply: message?.content?.trim() || "Could you tell me more about the campaign you'd like?",
    };
  }
  try {
    const fieldUpdates = JSON.parse(toolCall.function.arguments) as CampaignDraftFields;
    return {
      kind: "tool_call",
      reply: message.content?.trim() || "Updated the draft — take a look at the setup card.",
      fieldUpdates,
      assistantMessage: message,
      toolCallId: toolCall.id,
    };
  } catch {
    return { kind: "parse_error", reply: "I had trouble structuring that — could you rephrase?" };
  }
}

export type ChatReply = { reply: string; fieldUpdates: CampaignDraftFields | null; validationErrors: string[] };

export async function draftCampaignChatReply(input: {
  draft: CampaignDraft;
  history: CampaignDraftMessage[];
  userMessage: string;
}): Promise<ChatReply> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      reply: "OPENAI_API_KEY is not configured, so I can't draft campaigns yet. Ask an admin to set it.",
      fieldUpdates: null,
      validationErrors: [],
    };
  }

  const messages: Record<string, unknown>[] = [
    { role: "system", content: buildSystemPrompt() },
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userMessage },
  ];

  const first = await callOpenAi(apiKey, messages);
  if (!first) {
    return { reply: "The campaign assistant is unavailable right now — try again shortly.", fieldUpdates: null, validationErrors: [] };
  }

  const firstParsed = parseToolCall(first);
  if (firstParsed.kind !== "tool_call") {
    return { reply: firstParsed.reply, fieldUpdates: null, validationErrors: [] };
  }

  const firstErrors = validateDraftFields(firstParsed.fieldUpdates);
  if (firstErrors.length === 0) {
    return { reply: firstParsed.reply, fieldUpdates: firstParsed.fieldUpdates, validationErrors: [] };
  }

  messages.push(firstParsed.assistantMessage);
  messages.push({
    role: "tool",
    tool_call_id: firstParsed.toolCallId,
    content: `Rejected: ${firstErrors.join("; ")}. Call update_campaign_draft again with fixed values.`,
  });

  const second = await callOpenAi(apiKey, messages);
  if (!second) {
    return { reply: "The campaign assistant is unavailable right now — try again shortly.", fieldUpdates: null, validationErrors: firstErrors };
  }

  const secondParsed = parseToolCall(second);
  if (secondParsed.kind !== "tool_call") {
    return { reply: secondParsed.reply, fieldUpdates: null, validationErrors: firstErrors };
  }

  const secondErrors = validateDraftFields(secondParsed.fieldUpdates);
  if (secondErrors.length > 0) {
    return {
      reply: `I couldn't fit that within Google's ad rules (${secondErrors.join("; ")}). Try describing it differently.`,
      fieldUpdates: null,
      validationErrors: secondErrors,
    };
  }

  return { reply: secondParsed.reply, fieldUpdates: secondParsed.fieldUpdates, validationErrors: [] };
}
