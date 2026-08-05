import { defineComponent } from "@openuidev/lang-core";
import React from "react";
import { z } from "zod";

const ComparisonCardSchema = z.object({
  title: z.string().optional().default(""),
  leftLabel: z.string(),
  leftValue: z.string(),
  rightLabel: z.string(),
  rightValue: z.string(),
});
export type ComparisonCardProps = z.infer<typeof ComparisonCardSchema>;
export type ComparisonCardViewInput = { [K in keyof ComparisonCardProps]?: ComparisonCardProps[K] | null };

/** Pure, read-only presentation of a two-sided before/after or A-vs-B comparison. Dual-mode. */
export function ComparisonCardView(raw: ComparisonCardViewInput) {
  const title = raw.title ?? "";
  const side = (label: string, value: string) =>
    React.createElement(
      "div",
      { className: "flex flex-1 flex-col gap-1 rounded-lg border border-border bg-card p-4" },
      React.createElement("span", { className: "text-xs font-medium text-muted-foreground" }, label),
      React.createElement("span", { className: "text-xl font-semibold text-card-foreground" }, value),
    );
  return React.createElement(
    "div",
    { className: "flex flex-col gap-2" },
    title && React.createElement("span", { className: "text-sm font-medium text-card-foreground" }, title),
    React.createElement(
      "div",
      { className: "flex gap-3" },
      side(raw.leftLabel ?? "", raw.leftValue ?? ""),
      side(raw.rightLabel ?? "", raw.rightValue ?? ""),
    ),
  );
}

export const ComparisonCard = defineComponent({
  name: "ComparisonCard",
  description:
    "Displays a two-sided before/after or A-vs-B comparison: an optional title, then a left " +
    "{label, value} and a right {label, value} side by side. Args are POSITIONAL in that key order " +
    "(title, leftLabel, leftValue, rightLabel, rightValue). Unset title is \"\". Use for " +
    "this-week-vs-last-week, campaign A/B, or lead-tier-shift questions.",
  props: ComparisonCardSchema,
  component: ({ props }: { props: ComparisonCardViewInput }) => React.createElement(ComparisonCardView, props),
});

const TimelineEventSchema = z.object({ timestamp: z.string(), description: z.string() });
const TimelineSchema = z.object({
  title: z.string().optional().default(""),
  events: z.array(TimelineEventSchema).optional().default([]),
});
export type TimelineProps = z.infer<typeof TimelineSchema>;
export type TimelineViewInput = {
  title?: string | null;
  events?: (z.infer<typeof TimelineEventSchema> | null)[] | null;
};

/** Pure, read-only presentation of a chronological event list. Dual-mode. Reusable for CRM lead
 * activity, a campaign change log, or a Reports audit trail — one component, multiple callers. */
export function TimelineView(raw: TimelineViewInput) {
  const title = raw.title ?? "";
  const events = raw.events ?? [];
  return React.createElement(
    "div",
    { className: "flex flex-col gap-2 rounded-lg border border-border bg-card p-4" },
    title && React.createElement("span", { className: "text-sm font-medium text-card-foreground" }, title),
    events.length === 0
      ? React.createElement("p", { className: "text-sm text-muted-foreground" }, "No events yet.")
      : React.createElement(
          "ol",
          { className: "flex flex-col gap-2 border-l border-border pl-3" },
          ...events.map(
            (event, index) =>
              event &&
              React.createElement(
                "li",
                { key: index, className: "flex flex-col text-sm" },
                React.createElement("span", { className: "text-xs text-muted-foreground" }, event.timestamp),
                React.createElement("span", { className: "text-card-foreground" }, event.description),
              ),
          ),
        ),
  );
}

export const Timeline = defineComponent({
  name: "Timeline",
  description:
    "Displays a chronological list of {timestamp, description} events under an optional title. " +
    "Args are POSITIONAL in that key order. Unset title is \"\"; unset events is []. Use for lead " +
    "activity history, a campaign change log, or an audit trail.",
  props: TimelineSchema,
  component: ({ props }: { props: TimelineViewInput }) => React.createElement(TimelineView, props),
});

const RankedItemSchema = z.object({ label: z.string(), value: z.string() });
const RankedListSchema = z.object({
  title: z.string().optional().default(""),
  items: z.array(RankedItemSchema).optional().default([]),
});
export type RankedListProps = z.infer<typeof RankedListSchema>;
export type RankedListViewInput = {
  title?: string | null;
  items?: (z.infer<typeof RankedItemSchema> | null)[] | null;
};

/** Pure, read-only presentation of a ranked top-N list with rank badges. Dual-mode. Reusable for
 * top campaigns by spend, top leads by score, or top corridors by budget burn. */
export function RankedListView(raw: RankedListViewInput) {
  const title = raw.title ?? "";
  const items = raw.items ?? [];
  return React.createElement(
    "div",
    { className: "flex flex-col gap-2 rounded-lg border border-border bg-card p-4" },
    title && React.createElement("span", { className: "text-sm font-medium text-card-foreground" }, title),
    items.length === 0
      ? React.createElement("p", { className: "text-sm text-muted-foreground" }, "Nothing to rank yet.")
      : React.createElement(
          "ol",
          { className: "flex flex-col gap-1.5" },
          ...items.map(
            (item, index) =>
              item &&
              React.createElement(
                "li",
                { key: index, className: "flex items-center justify-between gap-2 text-sm" },
                React.createElement(
                  "span",
                  { className: "flex items-center gap-2" },
                  React.createElement(
                    "span",
                    { className: "flex size-5 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground" },
                    String(index + 1),
                  ),
                  React.createElement("span", { className: "text-card-foreground" }, item.label),
                ),
                React.createElement("span", { className: "font-medium text-card-foreground" }, item.value),
              ),
          ),
        ),
  );
}

export const RankedList = defineComponent({
  name: "RankedList",
  description:
    "Displays a ranked top-N list of {label, value} items with rank badges (1, 2, 3, ...) under an " +
    "optional title. Args are POSITIONAL in that key order. Unset title is \"\"; unset items is []. " +
    "Use for \"top N by X\" questions.",
  props: RankedListSchema,
  component: ({ props }: { props: RankedListViewInput }) => React.createElement(RankedListView, props),
});

const BatchActionItemSchema = z.object({
  label: z.string(),
  fromState: z.string().optional().default(""),
  toState: z.string().optional().default(""),
});
const BatchActionConfirmSchema = z.object({
  actionLabel: z.string(),
  items: z.array(BatchActionItemSchema).optional().default([]),
});
export type BatchActionConfirmProps = z.infer<typeof BatchActionConfirmSchema>;
export type BatchActionConfirmViewInput = {
  actionLabel?: string | null;
  items?: (z.infer<typeof BatchActionItemSchema> | null)[] | null;
};

/**
 * Pure, read-only presentation of a pending multi-item action — the batch-aware counterpart to
 * Spec 3's (unbuilt) single-item StageChangeConfirm. Same dual-mode convention as SetupCardView:
 * no onClick/onChange props, matching every other component in this file.
 *
 * ponytail: renders "Confirm"/"Cancel" as plain, unwired button elements — actually firing the
 * pending action is OpenUI's own Mutation()/@Run action system driven by a real ToolProvider
 * mutation, and platform-tools.ts (Task 10) ships with zero registered tools today (see this
 * plan's Global Constraints), so there is nothing for a click to invoke yet. Ceiling: this
 * component is visually complete but not wired to any real confirm/cancel action until a domain
 * registers its first mutation tool. Upgrade path: once Spec 3 (or any domain) adds a real
 * mutation ToolSpec, wire this view's buttons through OpenUI's Mutation() binding the same way
 * StageChangeConfirm is expected to.
 */
export function BatchActionConfirmView(raw: BatchActionConfirmViewInput) {
  const actionLabel = raw.actionLabel ?? "";
  const items = raw.items ?? [];
  return React.createElement(
    "div",
    { className: "flex flex-col gap-3 rounded-lg border border-border bg-card p-4" },
    React.createElement("span", { className: "text-sm font-medium text-card-foreground" }, actionLabel),
    items.length > 0 &&
      React.createElement(
        "ul",
        { className: "flex flex-col gap-1.5" },
        ...items.map(
          (item, index) =>
            item &&
            React.createElement(
              "li",
              { key: index, className: "flex items-center justify-between text-sm" },
              React.createElement("span", { className: "text-card-foreground" }, item.label),
              (item.fromState || item.toState) &&
                React.createElement(
                  "span",
                  { className: "text-xs text-muted-foreground" },
                  `${item.fromState || "—"} → ${item.toState || "—"}`,
                ),
            ),
        ),
      ),
    React.createElement(
      "div",
      { className: "flex gap-2" },
      React.createElement("button", { type: "button", className: "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" }, "Confirm"),
      React.createElement("button", { type: "button", className: "rounded-md border border-border px-3 py-1.5 text-xs font-medium text-card-foreground" }, "Cancel"),
    ),
  );
}

export const BatchActionConfirm = defineComponent({
  name: "BatchActionConfirm",
  description:
    "Shows a pending multi-item action before it executes: an action label (e.g. \"Pause these 3 " +
    "underperforming campaigns?\") and a list of affected items, each with an optional " +
    "fromState/toState. Args are POSITIONAL in that key order. Unset items is []. Use when the " +
    "model is about to act on multiple items at once — never execute the action without this " +
    "confirmation rendering first.",
  props: BatchActionConfirmSchema,
  component: ({ props }: { props: BatchActionConfirmViewInput }) => React.createElement(BatchActionConfirmView, props),
});
