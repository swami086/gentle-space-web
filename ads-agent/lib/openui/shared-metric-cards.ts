import { defineComponent } from "@openuidev/lang-core";
import React from "react";
import { z } from "zod";

/**
 * OpenUI maps positional args by Zod key order — see SetupCardSchema's comment in
 * campaign-library.ts for why `.optional().default(...)` is used instead of `.nullable()`
 * everywhere in this file and its siblings (shared-narrative-cards.ts, shared-structured-views.ts).
 */
const StatCardSchema = z.object({
  label: z.string(),
  /** Pre-formatted display string (e.g. "₹42,500", "128", "3.2%") — this component does no
   * number formatting itself, matching the "components render, callers format" convention already
   * established by SetupCardView's own formatInr() living in campaign-library.ts, not here. */
  value: z.string(),
  deltaLabel: z.string().optional().default(""),
  deltaDirection: z.enum(["up", "down", "flat"]).optional().default("flat"),
});

export type StatCardProps = z.infer<typeof StatCardSchema>;
export type StatCardViewInput = { [K in keyof StatCardProps]?: StatCardProps[K] | null };

function normalizeStatCardProps(raw: StatCardViewInput): StatCardProps {
  return {
    label: raw.label ?? "",
    value: raw.value ?? "",
    deltaLabel: raw.deltaLabel ?? "",
    deltaDirection: raw.deltaDirection ?? "flat",
  };
}

const DELTA_ARROW: Record<StatCardProps["deltaDirection"], string> = { up: "▲", down: "▼", flat: "" };
const DELTA_CLASS: Record<StatCardProps["deltaDirection"], string> = {
  up: "text-emerald-600 dark:text-emerald-400",
  down: "text-destructive",
  flat: "text-muted-foreground",
};

/** Pure, read-only presentation of a single metric — same dual-mode convention as
 * campaign-library.ts's SetupCardView: called directly for the deterministic path, wrapped via
 * defineComponent() below for the model path. */
export function StatCardView(raw: StatCardViewInput) {
  const props = normalizeStatCardProps(raw);
  return React.createElement(
    "div",
    { className: "flex flex-col gap-1 rounded-lg border border-border bg-card p-4" },
    React.createElement("span", { className: "text-xs font-medium text-muted-foreground" }, props.label),
    React.createElement("span", { className: "text-2xl font-semibold text-card-foreground" }, props.value),
    props.deltaLabel &&
      React.createElement(
        "span",
        { className: `text-xs font-medium ${DELTA_CLASS[props.deltaDirection]}` },
        `${DELTA_ARROW[props.deltaDirection]} ${props.deltaLabel}`.trim(),
      ),
  );
}

export const StatCard = defineComponent({
  name: "StatCard",
  description:
    "Displays one metric: a label, a pre-formatted value string, and an optional delta label with " +
    "direction (up/down/flat). Args are POSITIONAL in that key order. Unset deltaLabel is \"\"; " +
    "unset deltaDirection is \"flat\". Use for a single number the user asked about " +
    "(e.g. \"what's my CPL this week\") — for multiple related metrics, use KpiGrid instead.",
  props: StatCardSchema,
  component: ({ props }: { props: StatCardViewInput }) => React.createElement(StatCardView, props),
});

const KpiGridSchema = z.object({
  stats: z.array(StatCardSchema).optional().default([]),
});

export type KpiGridProps = z.infer<typeof KpiGridSchema>;
export type KpiGridViewInput = { stats?: (StatCardViewInput | null)[] | null };

/** Pure, read-only presentation of a scorecard — a grid of StatCardViews. */
export function KpiGridView(raw: KpiGridViewInput) {
  const stats = raw.stats ?? [];
  return React.createElement(
    "div",
    { className: "grid grid-cols-2 gap-3 sm:grid-cols-4" },
    ...stats.map((stat, index) => React.createElement(StatCardView, { key: index, ...(stat ?? {}) })),
  );
}

export const KpiGrid = defineComponent({
  name: "KpiGrid",
  description:
    "Displays a scorecard: a grid of StatCards, each { label, value, deltaLabel, deltaDirection }. " +
    "Use when the user asks for multiple related metrics at once (e.g. \"give me a scorecard for " +
    "this campaign\") instead of one StatCard per metric or a prose paragraph.",
  props: KpiGridSchema,
  component: ({ props }: { props: KpiGridViewInput }) => React.createElement(KpiGridView, props),
});
