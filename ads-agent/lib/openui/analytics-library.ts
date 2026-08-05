import { createLibrary, defineComponent } from "@openuidev/lang-core";
import React from "react";
import { z } from "zod";

const TrendPointSchema = z.object({ label: z.string(), value: z.number() });
const TrendChartSchema = z.object({
  title: z.string(),
  points: z.array(TrendPointSchema).optional().default([]),
});
export type TrendChartProps = z.infer<typeof TrendChartSchema>;
export type TrendChartViewInput = {
  title?: string | null;
  points?: ({ label?: string | null; value?: number | null } | null)[] | null;
};

/** Framework-light bar rendering (plain divs, no recharts import here) — matches lib/openui/*'s
 * no-shadcn/framework-light rule. Task 15's Reports page renders the richer recharts version for the
 * deterministic path; this is the chat-surface rendering, same split as OpportunityCard/LeadCard. */
export function TrendChartView(raw: TrendChartViewInput) {
  const points = (raw.points ?? []).map((p) => ({ label: p?.label ?? "", value: p?.value ?? 0 }));
  const max = Math.max(1, ...points.map((p) => p.value));
  return React.createElement(
    "div",
    { className: "flex flex-col gap-2" },
    React.createElement("span", { className: "text-sm font-medium" }, raw.title ?? ""),
    React.createElement(
      "div",
      { className: "flex items-end gap-3" },
      ...points.map((p, i) =>
        React.createElement(
          "div",
          { key: i, className: "flex flex-col items-center gap-1" },
          React.createElement("div", {
            className: "w-6 rounded-t bg-primary",
            style: { height: `${Math.max(4, (p.value / max) * 80)}px` },
          }),
          React.createElement("span", { className: "text-xs text-muted-foreground" }, p.label),
        ),
      ),
    ),
  );
}

const TrendChart = defineComponent({
  name: "TrendChart",
  description:
    "Displays a small bar chart: a title and a list of {label, value} points. Use for any " +
    "trend/comparison question (e.g. \"compare CPL by platform this week\").",
  props: TrendChartSchema,
  component: ({ props }: { props: TrendChartViewInput }) => React.createElement(TrendChartView, props),
});

const DataTableSchema = z.object({
  headers: z.array(z.string()).optional().default([]),
  rows: z.array(z.object({ cells: z.array(z.string()).optional().default([]) })).optional().default([]),
});
export type DataTableViewInput = {
  headers?: (string | null)[] | null;
  rows?: ({ cells?: (string | null)[] | null } | null)[] | null;
};

export function DataTableView(raw: DataTableViewInput) {
  const headers = (raw.headers ?? []).map((h) => h ?? "");
  const rows = (raw.rows ?? []).map((r) => (r?.cells ?? []).map((c) => c ?? ""));
  if (rows.length === 0) {
    return React.createElement("p", { className: "text-sm text-muted-foreground" }, "No data for that question.");
  }
  return React.createElement(
    "table",
    { className: "w-full text-sm" },
    React.createElement(
      "thead",
      null,
      React.createElement(
        "tr",
        null,
        ...headers.map((h, i) => React.createElement("th", { key: i, className: "text-left text-xs text-muted-foreground" }, h)),
      ),
    ),
    React.createElement(
      "tbody",
      null,
      ...rows.map((row, i) =>
        React.createElement(
          "tr",
          { key: i },
          ...row.map((cell, j) => React.createElement("td", { key: j, className: "py-1" }, cell)),
        ),
      ),
    ),
  );
}

const DataTable = defineComponent({
  name: "DataTable",
  description:
    "Displays tabular data: headers (string[]) and rows (each { cells: string[] }). Use for any " +
    "list-of-records question (e.g. \"top campaigns by spend\") — cells are pre-formatted strings, " +
    "this component does no number formatting itself.",
  props: DataTableSchema,
  component: ({ props }: { props: DataTableViewInput }) => React.createElement(DataTableView, props),
});

export const analyticsLibrary = createLibrary({
  components: [TrendChart, DataTable] as NonNullable<Parameters<typeof createLibrary>[0]["components"]>,
});
