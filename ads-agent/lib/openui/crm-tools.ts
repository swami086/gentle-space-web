import type { ToolSpec } from "@openuidev/lang-core";
import { getOpportunity, listOpportunities, updateOpportunityStage, PIPELINE_STAGES } from "../crm/twenty-pipeline";
import { logAiAction } from "../db/ai-action-log";
import type { ToolProviderMap } from "./platform-tools";

const STAGE_LABELS = new Map(PIPELINE_STAGES.map((s) => [s.value, s.label] as const));

export const crmToolProvider: ToolProviderMap = {
  list_opportunities: async () => listOpportunities(),
  search_opportunities: async (args: Record<string, unknown>) => {
    const query = String(args.query ?? "").toLowerCase();
    const all = await listOpportunities();
    if (!query) return all;
    return all.filter((o: { name: string }) => o.name.toLowerCase().includes(query));
  },
  get_opportunity: async (args: Record<string, unknown>) => getOpportunity(String(args.id ?? "")),
  advance_opportunity_stage: async (args: Record<string, unknown>) => {
    const id = String(args.id ?? "");
    const opportunityName = String(args.opportunityName ?? "");
    const toStage = String(args.toStage ?? "");
    const label = STAGE_LABELS.get(toStage as (typeof PIPELINE_STAGES)[number]["value"]);
    if (!label) return { ok: false, error: `unknown stage "${toStage}"` };

    const result = await updateOpportunityStage(id, toStage as (typeof PIPELINE_STAGES)[number]["value"]);
    if (result.ok) {
      await logAiAction({ domain: "crm", summary: `Advanced ${opportunityName} to ${label}` });
    }
    return result;
  },
};

export const crmToolSpecs: ToolSpec[] = [
  {
    name: "list_opportunities",
    description: "List every open CRM opportunity/lead across all pipeline stages.",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "array" },
  },
  {
    name: "search_opportunities",
    description: "Search CRM opportunities/leads by a case-insensitive name substring.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Name substring to search for" } },
      required: ["query"],
    },
    outputSchema: { type: "array" },
  },
  {
    name: "get_opportunity",
    description: "Get one CRM opportunity/lead by its exact id.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    outputSchema: { type: "object" },
  },
  {
    name: "advance_opportunity_stage",
    description:
      `Move an opportunity to a new pipeline stage. Valid toStage values: ${PIPELINE_STAGES.map((s) => s.value).join(", ")}. ` +
      "ALWAYS render StageChangeConfirm first and wait for the user's explicit confirmation before calling this.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        opportunityName: { type: "string", description: "Human-readable name, for the ai_action_log summary" },
        toStage: { type: "string" },
      },
      required: ["id", "opportunityName", "toStage"],
    },
    outputSchema: { type: "object" },
  },
];
