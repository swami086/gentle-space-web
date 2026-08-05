import { createLibrary, defineComponent } from "@openuidev/lang-core";
import React from "react";
import { z } from "zod";

const OpportunitySchema = z.object({
  name: z.string(),
  stage: z.string(),
  tier: z.enum(["HOT", "WARM", "COLD", "UNSCORED"]).optional().default("UNSCORED"),
  amountLabel: z.string().optional().default(""),
  maskedPhone: z.string().optional().default(""),
  source: z.string().optional().default(""),
});
export type OpportunityProps = z.infer<typeof OpportunitySchema>;
export type OpportunityViewInput = { [K in keyof OpportunityProps]?: OpportunityProps[K] | null };

function normalizeOpportunity(raw: OpportunityViewInput): OpportunityProps {
  return {
    name: raw.name ?? "",
    stage: raw.stage ?? "",
    tier: raw.tier ?? "UNSCORED",
    amountLabel: raw.amountLabel ?? "",
    maskedPhone: raw.maskedPhone ?? "",
    source: raw.source ?? "",
  };
}

/** Pure, read-only presentation of one opportunity — dual-mode convention (direct call for the CRM
 * board's LeadCard content, wrapped below for the model path). Framework-light per lib/openui/*'s
 * established rule (no lucide/shadcn/"use client") — the CRM page's LeadCard (Task 14) owns the
 * richer, interactive board-card presentation; this is the chat-surface rendering. */
export function OpportunityCardView(raw: OpportunityViewInput) {
  const props = normalizeOpportunity(raw);
  return React.createElement(
    "div",
    { className: "flex flex-col gap-1" },
    React.createElement("span", { className: "text-sm font-medium" }, props.name),
    React.createElement("span", { className: "text-xs text-muted-foreground" }, `${props.stage} · ${props.tier}`),
    props.amountLabel && React.createElement("span", { className: "text-xs" }, props.amountLabel),
    props.maskedPhone && React.createElement("span", { className: "text-xs text-muted-foreground" }, props.maskedPhone),
    props.source && React.createElement("span", { className: "text-xs text-muted-foreground" }, props.source),
  );
}

const OpportunityCard = defineComponent({
  name: "OpportunityCard",
  description:
    "Displays one CRM opportunity/lead: name, pipeline stage, tier (HOT/WARM/COLD/UNSCORED), a " +
    "pre-formatted amount label, a masked phone number, and source. Args are POSITIONAL in Zod key " +
    "order. Use when the user asks about exactly one specific lead (e.g. \"find Priya Sharma\").",
  props: OpportunitySchema,
  component: ({ props }: { props: OpportunityViewInput }) => React.createElement(OpportunityCardView, props),
});

const OpportunityListSchema = z.object({
  opportunities: z.array(OpportunitySchema).optional().default([]),
});
export type OpportunityListViewInput = { opportunities?: (OpportunityViewInput | null)[] | null };

export function OpportunityListView(raw: OpportunityListViewInput) {
  const opportunities = raw.opportunities ?? [];
  if (opportunities.length === 0) {
    return React.createElement("p", { className: "text-sm text-muted-foreground" }, "No opportunities found.");
  }
  return React.createElement(
    "div",
    { className: "flex flex-col gap-2" },
    ...opportunities.map((o, index) => React.createElement(OpportunityCardView, { key: index, ...(o ?? {}) })),
  );
}

const OpportunityList = defineComponent({
  name: "OpportunityList",
  description:
    "Displays a list of CRM opportunities/leads, each an OpportunityCard. Use for any multi-lead " +
    "answer (e.g. \"show me hot leads from this week\") instead of one OpportunityCard per lead or a " +
    "prose paragraph.",
  props: OpportunityListSchema,
  component: ({ props }: { props: OpportunityListViewInput }) => React.createElement(OpportunityListView, props),
});

const StageChangeConfirmSchema = z.object({
  opportunityName: z.string(),
  fromStage: z.string(),
  toStage: z.string(),
});
export type StageChangeConfirmProps = z.infer<typeof StageChangeConfirmSchema>;
export type StageChangeConfirmViewInput = { [K in keyof StageChangeConfirmProps]?: StageChangeConfirmProps[K] | null };

export function StageChangeConfirmView(raw: StageChangeConfirmViewInput) {
  return React.createElement(
    "div",
    { className: "flex flex-col gap-1 text-sm" },
    React.createElement("span", { className: "font-medium" }, "Confirm action"),
    React.createElement(
      "span",
      { className: "text-muted-foreground" },
      `Move ${raw.opportunityName ?? ""} from ${raw.fromStage ?? ""} → ${raw.toStage ?? ""}`,
    ),
  );
}

const StageChangeConfirm = defineComponent({
  name: "StageChangeConfirm",
  description:
    "Confirms an about-to-happen pipeline stage change before advance_opportunity_stage is called: " +
    "opportunityName, fromStage, toStage. Render this BEFORE calling the mutation, not after.",
  props: StageChangeConfirmSchema,
  component: ({ props }: { props: StageChangeConfirmViewInput }) =>
    React.createElement(StageChangeConfirmView, props),
});

export const crmLibrary = createLibrary({
  components: [OpportunityCard, OpportunityList, StageChangeConfirm] as NonNullable<
    Parameters<typeof createLibrary>[0]["components"]
  >,
});
