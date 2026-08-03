import type { CampaignDraft, CampaignDraftFields, CampaignDraftMessage } from "../types";
import { validateDraftFields } from "./campaign-draft-rules";
import { playbookContextFor } from "./playbook-context";
import { STRATEGY } from "./strategy-config";
import {
  generateContent,
  firstFunctionCall,
  firstTextPart,
  isVertexConfigured,
  responseParts,
  type FunctionDeclaration,
  type GeminiContent,
  type GeminiResponse,
} from "../vertex/client";

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

const UPDATE_DRAFT_TOOL_NAME = "update_campaign_draft";

// Gemini's function-calling "auto" mode is unreliable here — the model sometimes
// replies in plain text claiming it set fields without actually calling the tool.
// Forcing "any" mode (every turn must call this tool) fixes that, but Gemini's "any"
// mode returns *only* the function call with no accompanying text — so the
// conversational reply has to travel as a tool argument, per Google's own guidance.
const UPDATE_DRAFT_TOOL: FunctionDeclaration = {
  name: UPDATE_DRAFT_TOOL_NAME,
  description:
    "Call this on every turn. Write any subset of the campaign draft's fields as they become known, and always include your conversational reply to the user.",
  parameters: {
    type: "object",
    properties: {
      assistantReply: {
        type: "string",
        description:
          "Your conversational reply to show the user — a short follow-up question if a required field is still missing/ambiguous, or a short acknowledgment of what you just set.",
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
      headlines: { type: "array", items: { type: "string" }, description: "3-15 items, each <=30 chars" },
      descriptions: { type: "array", items: { type: "string" }, description: "2-4 items, each <=90 chars" },
      finalUrl: { type: "string" },
    },
    required: ["assistantReply"],
  },
};

type ParsedToolCall =
  | { kind: "no_tool_call"; reply: string }
  | {
      kind: "tool_call";
      reply: string;
      fieldUpdates: CampaignDraftFields;
      modelContent: GeminiContent;
    };

function parseToolCall(response: GeminiResponse): ParsedToolCall {
  const call = firstFunctionCall(response, UPDATE_DRAFT_TOOL_NAME);
  const text = firstTextPart(response);
  if (!call) {
    return { kind: "no_tool_call", reply: text || "Could you tell me more about the campaign you'd like?" };
  }
  const { assistantReply, ...fieldUpdates } = call.args as CampaignDraftFields & { assistantReply?: string };
  return {
    kind: "tool_call",
    reply: (typeof assistantReply === "string" && assistantReply.trim()) || text || "Updated the draft — take a look at the setup card.",
    fieldUpdates: fieldUpdates as CampaignDraftFields,
    modelContent: { role: "model", parts: responseParts(response) },
  };
}

export type ChatReply = { reply: string; fieldUpdates: CampaignDraftFields | null; validationErrors: string[] };

export async function draftCampaignChatReply(input: {
  draft: CampaignDraft;
  history: CampaignDraftMessage[];
  userMessage: string;
}): Promise<ChatReply> {
  if (!isVertexConfigured()) {
    return {
      reply:
        "Vertex AI is not configured (GOOGLE_CLOUD_PROJECT / GOOGLE_APPLICATION_CREDENTIALS), so I can't draft campaigns yet. Ask an admin to set it.",
      fieldUpdates: null,
      validationErrors: [],
    };
  }

  const contents: GeminiContent[] = [
    ...input.history.map((m) => ({
      role: (m.role === "assistant" ? "model" : "user") as "user" | "model",
      parts: [{ text: m.content }],
    })),
    { role: "user" as const, parts: [{ text: input.userMessage }] },
  ];

  let first: GeminiResponse;
  try {
    first = await generateContent({
      systemInstruction: buildSystemPrompt(),
      contents,
      tools: [UPDATE_DRAFT_TOOL],
      toolChoice: "any",
      temperature: 0.3,
      maxOutputTokens: 600,
      timeoutMs: 15_000,
    });
  } catch {
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

  contents.push(firstParsed.modelContent);
  contents.push({
    role: "user",
    parts: [
      {
        functionResponse: {
          name: UPDATE_DRAFT_TOOL_NAME,
          response: {
            result: `Rejected: ${firstErrors.join("; ")}. Call update_campaign_draft again with fixed values.`,
          },
        },
      },
    ],
  });

  let second: GeminiResponse;
  try {
    second = await generateContent({
      systemInstruction: buildSystemPrompt(),
      contents,
      tools: [UPDATE_DRAFT_TOOL],
      toolChoice: "any",
      temperature: 0.3,
      maxOutputTokens: 600,
      timeoutMs: 15_000,
    });
  } catch {
    return {
      reply: "The campaign assistant is unavailable right now — try again shortly.",
      fieldUpdates: null,
      validationErrors: firstErrors,
    };
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
