import { defineComponent, createLibrary, createParser } from "@openuidev/lang-core";
import React from "react";
import { z } from "zod";
import type { CampaignDraftKeyword } from "../types";
import {
  DEFAULT_FINAL_URL,
  normalizeSetupCardLang,
} from "./normalize-setup-card";

export { DEFAULT_FINAL_URL, SETUP_CARD_PROP_KEYS, normalizeSetupCardLang } from "./normalize-setup-card";

const KeywordSchema = z.object({
  text: z.string(),
  matchType: z.enum(["broad", "phrase", "exact"]),
});

/**
 * OpenUI maps positional args by Zod key order. Use `.optional().default(...)`
 * (not `.nullable()`): the parser rejects `null` on required fields even when
 * Zod allows null — see OpenUI defining-components + v0.5 core rules.
 */
const SetupCardSchema = z.object({
  assistantReply: z.string(),
  status: z.enum(["chatting", "ready", "converted"]),
  corridor: z.string().optional().default(""),
  dailyBudgetInr: z.number().optional().default(0),
  adGroupName: z.string().optional().default(""),
  keywords: z.array(KeywordSchema).optional().default([]),
  headlines: z.array(z.string()).optional().default([]),
  descriptions: z.array(z.string()).optional().default([]),
  finalUrl: z.string().optional().default(DEFAULT_FINAL_URL),
});

export type SetupCardProps = z.infer<typeof SetupCardSchema>;

/** Props OpenUI's streaming Renderer may hand us before Zod defaults apply (nulls included). */
export type SetupCardViewInput = {
  [K in keyof SetupCardProps]?: SetupCardProps[K] | null;
};

/** OpenUI streaming may pass null for optional props before defaults apply — normalize once. */
function normalizeSetupCardViewProps(raw: SetupCardViewInput): SetupCardProps {
  return {
    assistantReply: raw.assistantReply ?? "",
    status: raw.status ?? "chatting",
    corridor: raw.corridor ?? "",
    dailyBudgetInr: raw.dailyBudgetInr ?? 0,
    adGroupName: raw.adGroupName ?? "",
    keywords: raw.keywords ?? [],
    headlines: raw.headlines ?? [],
    descriptions: raw.descriptions ?? [],
    finalUrl: raw.finalUrl ?? DEFAULT_FINAL_URL,
  };
}

function formatInr(value: number): string {
  return value === 0 ? "—" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/** Pure, read-only presentation of a campaign draft's setup fields. No inputs/onChange — editing
 * happens exclusively through ManualEditForm; this view is used both as OpenUI's rendered output
 * (via SetupCard below) and directly, driven by real draft state, for the "AI view, at rest" case. */
export function SetupCardView(raw: SetupCardViewInput) {
  // ponytail: plain span instead of Badge — keeps this module free of client-only UI imports so
  // campaign-chat (server) can import campaignLibrary.prompt()/parseSetupCardResponse without
  // pulling shadcn into the API route bundle. Ceiling: no Badge variant styling; upgrade by
  // splitting SetupCardView into a .tsx client module if visual parity with ManualEditForm is needed.
  const props = normalizeSetupCardViewProps(raw);
  const statusClass =
    props.status === "ready"
      ? "inline-flex rounded-md bg-primary px-2 py-0.5 text-xs text-primary-foreground"
      : "inline-flex rounded-md border px-2 py-0.5 text-xs";

  return React.createElement(
    "div",
    { className: "flex flex-col gap-4" },
    React.createElement(
      "div",
      { className: "flex items-center justify-between" },
      React.createElement("span", { className: "text-sm font-medium" }, "Status"),
      React.createElement("span", { className: statusClass }, props.status),
    ),
    React.createElement(
      "div",
      { className: "text-sm" },
      React.createElement("span", { className: "font-medium" }, "Corridor:"),
      " ",
      props.corridor || "Not set yet",
    ),
    React.createElement(
      "div",
      { className: "text-sm" },
      React.createElement("span", { className: "font-medium" }, "Daily budget:"),
      " ",
      formatInr(props.dailyBudgetInr),
    ),
    React.createElement(
      "div",
      { className: "text-sm" },
      React.createElement("span", { className: "font-medium" }, "Ad group:"),
      " ",
      props.adGroupName || "Not set yet",
    ),
    React.createElement(
      "div",
      { className: "flex flex-col gap-1 text-sm" },
      React.createElement("span", { className: "font-medium" }, `Keywords (${props.keywords.length})`),
      props.keywords.length === 0 &&
        React.createElement("p", { className: "text-muted-foreground" }, "Not set yet."),
      ...props.keywords.map((keyword: CampaignDraftKeyword, index: number) =>
        React.createElement(
          "p",
          { key: index, className: "text-muted-foreground" },
          `${keyword.text} (${keyword.matchType})`,
        ),
      ),
    ),
    React.createElement(
      "div",
      { className: "flex flex-col gap-1 text-sm" },
      React.createElement(
        "span",
        { className: "font-medium" },
        `Headlines (${props.headlines.length}/15, ≤30 chars)`,
      ),
      props.headlines.length === 0 &&
        React.createElement("p", { className: "text-muted-foreground" }, "Not set yet."),
      ...props.headlines.map((headline: string, index: number) =>
        React.createElement("p", { key: index, className: "text-muted-foreground" }, headline),
      ),
    ),
    React.createElement(
      "div",
      { className: "flex flex-col gap-1 text-sm" },
      React.createElement(
        "span",
        { className: "font-medium" },
        `Descriptions (${props.descriptions.length}/4, ≤90 chars)`,
      ),
      props.descriptions.length === 0 &&
        React.createElement("p", { className: "text-muted-foreground" }, "Not set yet."),
      ...props.descriptions.map((description: string, index: number) =>
        React.createElement("p", { key: index, className: "text-muted-foreground" }, description),
      ),
    ),
    React.createElement(
      "div",
      { className: "text-sm" },
      React.createElement("span", { className: "font-medium" }, "Final URL:"),
      " ",
      props.finalUrl,
    ),
  );
}

const SetupCard = defineComponent({
  name: "SetupCard",
  description:
    "Displays the assistant's proposed Google Ads campaign draft: a short conversational reply, " +
    "readiness status, corridor, daily budget in INR, ad group name, keywords, headlines (3-15, " +
    "each <=30 chars), descriptions (2-4, each <=90 chars), and the final URL. " +
    "Args are POSITIONAL in that key order. Unset strings use \"\"; unset budget uses 0; unset lists use []. Never null.",
  props: SetupCardSchema,
  component: ({ props }: { props: SetupCardViewInput }) => React.createElement(SetupCardView, props),
});

export const campaignLibrary = createLibrary({ root: "SetupCard", components: [SetupCard] });

/**
 * Official OpenUI PromptOptions (preamble / additionalRules / examples).
 * @see https://www.openui.com/docs/openui-lang/defining-components#prompt-options
 */
export function buildCampaignPromptOptions(preamble: string) {
  return {
    preamble,
    additionalRules: [
      "SetupCard arguments are POSITIONAL only (Zod key order). Write SetupCard(\"reply\", \"chatting\", \"Whitefield\", 500) — NEVER assistantReply=\"...\" or status: \"chatting\".",
      'Unset fields: use "" for strings, 0 for dailyBudgetInr, [] for lists. Never emit null.',
      `Omit trailing optional args when unset is fine; otherwise default finalUrl to ${DEFAULT_FINAL_URL}.`,
      "Output only openui-lang (root = SetupCard(...)). No markdown fences, no prose outside the statement.",
    ],
    examples: [
      `root = SetupCard("Got Whitefield at ₹500/day. What ad group name should we use?", "chatting", "Whitefield", 500)`,
      `root = SetupCard("Sure — which Bangalore corridor should this campaign target?", "chatting")`,
    ],
  };
}

export type ParsedSetupCard =
  | { kind: "ok"; props: SetupCardProps }
  | { kind: "parse_error"; errors: string[] };

/** Replaces JSON.parse(responseText) — parses OpenUI Lang text into validated SetupCard props. */
export function parseSetupCardResponse(text: string): ParsedSetupCard {
  if (!text.trim()) return { kind: "parse_error", errors: ["empty response"] };

  const normalized = normalizeSetupCardLang(text);
  const parser = createParser(campaignLibrary.toJSONSchema());
  let result: ReturnType<typeof parser.parse>;
  try {
    result = parser.parse(normalized);
  } catch (err) {
    return { kind: "parse_error", errors: [err instanceof Error ? err.message : "parse exception"] };
  }

  if (!result.root || result.root.typeName !== "SetupCard") {
    const meta = result.meta.errors.map((e) => `${e.path || "(root)"}: ${e.message}`);
    return {
      kind: "parse_error",
      errors: meta.length > 0 ? meta : ["no SetupCard root parsed"],
    };
  }
  if (result.meta.errors.length > 0) {
    return { kind: "parse_error", errors: result.meta.errors.map((e) => `${e.path}: ${e.message}`) };
  }

  const parsed = SetupCardSchema.safeParse(result.root.props);
  if (!parsed.success) {
    return {
      kind: "parse_error",
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  return { kind: "ok", props: parsed.data };
}
