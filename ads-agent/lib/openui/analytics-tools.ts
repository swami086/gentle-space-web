import type { ToolSpec } from "@openuidev/lang-core";
import { allocateEqualSplit } from "../attribution/allocation";
import { trailingWindow } from "../attribution/window";
import { readAttribution } from "../db/attribution";
import { corridorListingIds } from "../db/corridors";
import { getSpendCplTrend, listCampaignsWithLatestCpl } from "../db/dashboard";
import { listProposals } from "../db/proposals";
import type { Scope } from "../db/scope-sql";
import type { ToolProviderMap } from "./platform-tools";

type ScopedToolHandler = (scope: Scope, args: Record<string, unknown>) => Promise<unknown>;

function daysArg(args: Record<string, unknown>): number {
  return typeof args.days === "number" ? args.days : 7;
}

export const analyticsToolHandlers: Record<string, ScopedToolHandler> = {
  get_spend_cpl_trend: async (scope, args) => {
    return getSpendCplTrend(scope, daysArg(args));
  },
  list_campaigns_with_cpl: async (scope) => listCampaignsWithLatestCpl(scope),
  list_pending_proposals: async (scope) => listProposals(scope, "pending"),

  get_corridor_attribution: async (scope, args) => {
    const stored = await readAttribution(scope, trailingWindow(daysArg(args), new Date()));
    if (!stored) {
      return { computed: false, reason: "no attribution has been computed for this window" };
    }
    return {
      window: stored.window,
      windowState: stored.windowState,
      corridors: stored.corridors,
      residual: stored.residual,
      lateEnquiryCount: stored.lateEnquiryCount,
      totals: stored.totals,
      freshness: stored.freshness,
      authority: stored.authority,
    };
  },

  get_per_space_cost_estimate: async (scope, args) => {
    const corridorId = typeof args.corridorId === "string" ? args.corridorId : null;
    if (!corridorId) throw new Error("get_per_space_cost_estimate requires a corridorId");

    const window = trailingWindow(daysArg(args), new Date());
    const stored = await readAttribution(scope, window);
    const corridor = stored?.corridors.find((c) => c.corridorId === corridorId);
    if (!corridor) {
      return {
        window,
        estimates: [],
        reason: "that corridor had no spend or enquiries in this window",
      };
    }

    const listingIds = await corridorListingIds(scope, corridorId);
    return {
      window,
      basis: "equal_split",
      authority: stored!.authority,
      estimates: allocateEqualSplit({
        corridorId,
        spendInr: corridor.spendInr,
        enquiryCount: corridor.enquiryCount,
        listingIds,
      }),
    };
  },
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
  {
    name: "get_corridor_attribution",
    description:
      "Measured spend, enquiry count and cost per enquiry per corridor for the last N days " +
      "(default 7), plus the residual: spend and enquiries that belong to no corridor. The " +
      "residual is never divided across corridors. Figures are derived and carry their CDC lag.",
    inputSchema: {
      type: "object",
      properties: { days: { type: "number", description: "Number of days back, default 7" } },
      required: [],
    },
    outputSchema: { type: "object" },
  },
  {
    name: "get_per_space_cost_estimate",
    description:
      "Per-space cost for one corridor as an equal-split estimate, not a measurement: campaigns " +
      "are corridor-level so per-space spend cannot be measured. Every row is labelled an estimate.",
    inputSchema: {
      type: "object",
      properties: {
        corridorId: { type: "string", description: "The corridor to allocate across its listings" },
        days: { type: "number", description: "Number of days back, default 7" },
      },
      required: ["corridorId"],
    },
    outputSchema: { type: "object" },
  },
];
