import { defineComponent } from "@openuidev/lang-core";
import React from "react";
import { z } from "zod";

const InsightCalloutSchema = z.object({
  headline: z.string(),
  supportingStat: z.string().optional().default(""),
  tone: z.enum(["neutral", "positive", "negative"]).optional().default("neutral"),
});
export type InsightCalloutProps = z.infer<typeof InsightCalloutSchema>;
export type InsightCalloutViewInput = { [K in keyof InsightCalloutProps]?: InsightCalloutProps[K] | null };

const TONE_CLASS: Record<InsightCalloutProps["tone"], string> = {
  neutral: "border-border bg-card",
  positive: "border-emerald-500/30 bg-emerald-500/5",
  negative: "border-destructive/30 bg-destructive/5",
};

/** Pure, read-only presentation — the default fallback for any qualitative ("why") answer that
 * isn't a chart/table. Dual-mode: called directly, or wrapped via defineComponent() below. */
export function InsightCalloutView(raw: InsightCalloutViewInput) {
  const headline = raw.headline ?? "";
  const supportingStat = raw.supportingStat ?? "";
  const tone = raw.tone ?? "neutral";
  return React.createElement(
    "div",
    { className: `flex flex-col gap-1 rounded-lg border p-4 ${TONE_CLASS[tone]}` },
    React.createElement("span", { className: "text-sm font-medium text-card-foreground" }, headline),
    supportingStat && React.createElement("span", { className: "text-xs text-muted-foreground" }, supportingStat),
  );
}

export const InsightCallout = defineComponent({
  name: "InsightCallout",
  description:
    "Displays a short headline and an optional one-line supporting stat, with a tone accent " +
    "(neutral/positive/negative). Args are POSITIONAL in that key order. Unset supportingStat is " +
    "\"\"; unset tone is \"neutral\". Use as the default answer shape for qualitative or \"why\" " +
    "questions that have no more specific component match.",
  props: InsightCalloutSchema,
  component: ({ props }: { props: InsightCalloutViewInput }) => React.createElement(InsightCalloutView, props),
});

const ChecklistItemSchema = z.object({
  text: z.string(),
  status: z.enum(["done", "pending", "warning"]),
});
const ChecklistCardSchema = z.object({
  title: z.string().optional().default(""),
  items: z.array(ChecklistItemSchema).optional().default([]),
});
export type ChecklistCardProps = z.infer<typeof ChecklistCardSchema>;
export type ChecklistCardViewInput = {
  title?: string | null;
  items?: (z.infer<typeof ChecklistItemSchema> | null)[] | null;
};

const STATUS_MARK: Record<z.infer<typeof ChecklistItemSchema>["status"], string> = {
  done: "✓",
  pending: "○",
  warning: "!",
};
const STATUS_CLASS: Record<z.infer<typeof ChecklistItemSchema>["status"], string> = {
  done: "text-emerald-600 dark:text-emerald-400",
  pending: "text-muted-foreground",
  warning: "text-destructive",
};

/** Pure, read-only presentation of a multi-item checklist. Dual-mode, same convention as above. */
export function ChecklistCardView(raw: ChecklistCardViewInput) {
  const title = raw.title ?? "";
  const items = raw.items ?? [];
  return React.createElement(
    "div",
    { className: "flex flex-col gap-2 rounded-lg border border-border bg-card p-4" },
    title && React.createElement("span", { className: "text-sm font-medium text-card-foreground" }, title),
    items.length === 0
      ? React.createElement("p", { className: "text-sm text-muted-foreground" }, "Nothing to review.")
      : React.createElement(
          "ul",
          { className: "flex flex-col gap-1.5" },
          ...items.map(
            (item, index) =>
              item &&
              React.createElement(
                "li",
                { key: index, className: "flex items-start gap-2 text-sm" },
                React.createElement("span", { className: `w-4 shrink-0 font-medium ${STATUS_CLASS[item.status]}` }, STATUS_MARK[item.status]),
                React.createElement("span", { className: "text-card-foreground" }, item.text),
              ),
          ),
        ),
  );
}

export const ChecklistCard = defineComponent({
  name: "ChecklistCard",
  description:
    "Displays a titled list of items, each with a status (done/pending/warning) shown as an icon. " +
    "Args are POSITIONAL in that key order. Unset title is \"\"; unset items is []. Use for " +
    "multi-item answers (\"3 things to review today\") instead of a numbered-list paragraph.",
  props: ChecklistCardSchema,
  component: ({ props }: { props: ChecklistCardViewInput }) => React.createElement(ChecklistCardView, props),
});

const AlertBannerSchema = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  title: z.string(),
  detail: z.string().optional().default(""),
});
export type AlertBannerProps = z.infer<typeof AlertBannerSchema>;
export type AlertBannerViewInput = { [K in keyof AlertBannerProps]?: AlertBannerProps[K] | null };

const SEVERITY_CLASS: Record<AlertBannerProps["severity"], string> = {
  info: "border-border bg-card text-card-foreground",
  warning: "border-amber-500/50 bg-amber-500/10 text-card-foreground",
  critical: "border-destructive/50 bg-destructive/10 text-destructive",
};

/** Pure, read-only presentation — distinct heavier visual weight than InsightCallout, for the
 * "why is this flagged?" answer after a user clicks a proactive-signaling badge (see foundation
 * spec's Proactive signaling section). Dual-mode, same convention as above. */
export function AlertBannerView(raw: AlertBannerViewInput) {
  const severity = raw.severity ?? "info";
  const title = raw.title ?? "";
  const detail = raw.detail ?? "";
  return React.createElement(
    "div",
    { className: `flex flex-col gap-1 rounded-lg border p-4 ${SEVERITY_CLASS[severity]}` },
    React.createElement("span", { className: "text-sm font-semibold" }, title),
    detail && React.createElement("span", { className: "text-xs opacity-90" }, detail),
  );
}

export const AlertBanner = defineComponent({
  name: "AlertBanner",
  description:
    "Displays a severity-flagged alert (info/warning/critical) with a title and optional detail " +
    "sentence. Args are POSITIONAL in that key order. Unset detail is \"\". Use when explaining why " +
    "something was flagged as urgent — visually heavier than InsightCallout on purpose.",
  props: AlertBannerSchema,
  component: ({ props }: { props: AlertBannerViewInput }) => React.createElement(AlertBannerView, props),
});
