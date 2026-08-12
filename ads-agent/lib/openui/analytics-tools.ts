import type { ToolSpec } from "@openuidev/lang-core";
import { getSpendCplTrend, listCampaignsWithLatestCpl } from "../db/dashboard";
import { listProposals } from "../db/proposals";
import type { Scope } from "../db/scope-sql";
import type { ToolProviderMap } from "./platform-tools";

type ScopedToolHandler = (scope: Scope, args: Record<string, unknown>) => Promise<unknown>;

export const analyticsToolHandlers: Record<string, ScopedToolHandler> = {
  get_spend_cpl_trend: async (scope, args) => {
    const days = typeof args.days === "number" ? args.days : 7;
    return getSpendCplTrend(scope, days);
  },
  list_campaigns_with_cpl: async (scope) => listCampaignsWithLatestCpl(scope),
  list_pending_proposals: async (scope) => listProposals(scope, "pending"),
};

function bindScopedHandlers(handlers: Record<string, ScopedToolHandler>): ToolProviderMap {
  return Object.fromEntries(
    Object.entries(handlers).map(([name, fn]) => [
      name,
      (args: Record<string, unknown>) => {
        const orgId = process.env.ADS_AGENT_ORG_ID;
        if (!orgId) throw new Error("ADS_AGENT_ORG_ID is not set");
        return fn({ kind: "org" as const, orgId }, args);
      },
    ]),
  );
}

export const analyticsToolProvider: ToolProviderMap = bindScopedHandlers(analyticsToolHandlers);

export const analyticsToolSpecs: ToolSpec[] = [
  {
    name: "get_spend_cpl_trend",
    description: "Get the daily spend/CPL trend for the last N days (default 7).",
    inputSchema: {
      type: "object",
      properties: { days: { type: "number", description: "Number of days back, default 7" } },
      required: [],
    },
    outputSchema: { type: "object" },
  },
  {
    name: "list_campaigns_with_cpl",
    description: "List every campaign with its platform, status, daily budget, corridor, and latest CPL.",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "array" },
  },
  {
    name: "list_pending_proposals",
    description: "List every proposal currently awaiting human approval.",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "array" },
  },
];
