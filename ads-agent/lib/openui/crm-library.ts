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
  // Tolerate Query envelopes / nulls from bad column-pluck (`array.opportunities` → [null,…]).
  const incoming = raw.opportunities as unknown;
  const opportunities = (
    Array.isArray(incoming)
      ? incoming
      : incoming &&
          typeof incoming === "object" &&
          Array.isArray((incoming as { opportunities?: unknown }).opportunities)
        ? ((incoming as { opportunities: (OpportunityViewInput | null)[] }).opportunities ?? [])
        : []
  ).filter((o): o is OpportunityViewInput => o != null && typeof o === "object");
  if (opportunities.length === 0) {
    return React.createElement("p", { className: "text-sm text-muted-foreground" }, "No opportunities found.");
  }
  return React.createElement(
    "div",
    { className: "flex flex-col gap-2" },
    ...opportunities.map((o, index) => React.createElement(OpportunityCardView, { key: index, ...o })),
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
  opportunityId: z.string().optional().default(""),
  opportunityName: z.string(),
  fromStage: z.string(),
  toStage: z.string(),
});
export type StageChangeConfirmProps = z.infer<typeof StageChangeConfirmSchema>;
export type StageChangeConfirmViewInput = { [K in keyof StageChangeConfirmProps]?: StageChangeConfirmProps[K] | null };

/** Dispatched after a successful Confirm so the CRM board can `router.refresh()`. */
export const CRM_STAGE_ADVANCED_EVENT = "ads-agent:crm-stage-advanced";

export function StageChangeConfirmView(raw: StageChangeConfirmViewInput) {
  const opportunityId = raw.opportunityId ?? "";
  const opportunityName = raw.opportunityName ?? "";
  const fromStage = raw.fromStage ?? "";
  const toStage = raw.toStage ?? "";

  // ponytail: imperative button updates avoid useState so this stays callable from Vitest without a React root
  async function onConfirm(e: React.MouseEvent<HTMLButtonElement>) {
    if (!opportunityId) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = "Updating…";
    try {
      const res = await fetch(`/api/crm/opportunities/${encodeURIComponent(opportunityId)}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStage, opportunityName }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      btn.textContent = "Done";
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(CRM_STAGE_ADVANCED_EVENT, { detail: { opportunityId, toStage } }));
      }
    } catch {
      btn.disabled = false;
      btn.textContent = prev ?? "Confirm";
    }
  }

  return React.createElement(
    "div",
    { className: "flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm" },
    React.createElement("span", { className: "font-medium" }, "Confirm action"),
    React.createElement(
      "span",
      { className: "text-muted-foreground" },
      `Move ${opportunityName} from ${fromStage} → ${toStage}`,
    ),
    React.createElement(
      "button",
      {
        type: "button",
        className:
          "w-fit rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50",
        disabled: !opportunityId,
        onClick: (e: React.MouseEvent<HTMLButtonElement>) => void onConfirm(e),
      },
      "Confirm",
    ),
    !opportunityId &&
      React.createElement(
        "span",
        { className: "text-xs text-muted-foreground" },
        "Missing opportunityId — ask the assistant to include the lead id.",
      ),
  );
}

const StageChangeConfirm = defineComponent({
  name: "StageChangeConfirm",
  description:
    "Confirms an about-to-happen pipeline stage change before it is applied: opportunityId (required " +
    "for the Confirm button), opportunityName, fromStage, toStage. Render this BEFORE any stage " +
    "mutation; the Confirm button PATCHes /api/crm/opportunities/[id]/stage.",
  props: StageChangeConfirmSchema,
  component: ({ props }: { props: StageChangeConfirmViewInput }) =>
    React.createElement(StageChangeConfirmView, props),
});

export const crmLibrary = createLibrary({
  components: [OpportunityCard, OpportunityList, StageChangeConfirm] as NonNullable<
    Parameters<typeof createLibrary>[0]["components"]
  >,
});
