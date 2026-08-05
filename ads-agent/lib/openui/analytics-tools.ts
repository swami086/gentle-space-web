import type { ToolSpec } from "@openuidev/lang-core";
import { getSpendCplTrend, listCampaignsWithLatestCpl } from "../db/dashboard";
import { listProposals } from "../db/proposals";
import type { ToolProviderMap } from "./platform-tools";

export const analyticsToolProvider: ToolProviderMap = {
  get_spend_cpl_trend: async (args: Record<string, unknown>) => {
    const days = typeof args.days === "number" ? args.days : 7;
    return getSpendCplTrend(days);
  },
  list_campaigns_with_cpl: async () => listCampaignsWithLatestCpl(),
  list_pending_proposals: async () => listProposals("pending"),
};

export const analyticsToolSpecs: ToolSpec[] = [
  {
    name: "get_spend_cpl_trend",
    description: "Get the daily spend/CPL trend for the last N days (default 7).",
    parameters: {
      type: "object",
      properties: { days: { type: "number", description: "Number of days back, default 7" } },
      required: [],
    },
  },
  {
    name: "list_campaigns_with_cpl",
    description: "List every campaign with its platform, status, daily budget, corridor, and latest CPL.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_pending_proposals",
    description: "List every proposal currently awaiting human approval.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];
