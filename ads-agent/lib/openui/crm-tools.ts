import type { ToolSpec } from "@openuidev/lang-core";
import { scopeForJob } from "@/lib/auth/scope-interim";
import {
  getOpportunity,
  listOpportunities,
  toOpenUiOpportunityCard,
  updateOpportunityStage,
  PIPELINE_STAGES,
  type Opportunity,
  type OpenUiOpportunityCardRow,
} from "../crm/twenty-pipeline";
import { writeAudit } from "../db/audit-log";
import type { Scope } from "../db/scope-sql";
import type { ToolProviderMap } from "./platform-tools";

const STAGE_LABELS = new Map(PIPELINE_STAGES.map((s) => [s.value, s.label] as const));

type ScopedToolHandler = (scope: Scope, args: Record<string, unknown>) => Promise<unknown>;

/** OpenUI OpportunityCard Zod shape — rows inside the Query envelope (see toOpenUiListResult). */
function toOpenUiRows(rows: Opportunity[]): OpenUiOpportunityCardRow[] {
  return rows.map(toOpenUiOpportunityCard);
}

/**
 * OpenUI Query results should be objects with named fields + matching defaults
 * (`data = Query("tool", {}, {opportunities: []})`, then `OpportunityList(data.opportunities)`).
 * A bare array makes models emit `list.opportunities` which column-plucks null from every row.
 * @see https://www.openui.com/docs/openui-lang/queries-mutations
 */
export type OpenUiOpportunityListResult = { opportunities: OpenUiOpportunityCardRow[] };

function toOpenUiListResult(rows: Opportunity[]): OpenUiOpportunityListResult {
  return { opportunities: toOpenUiRows(rows) };
}

export const crmToolHandlers: Record<string, ScopedToolHandler> = {
  list_opportunities: async () => toOpenUiListResult(await listOpportunities()),
  search_opportunities: async (_scope, args) => {
    const query = String(args.query ?? "").toLowerCase();
    const all = await listOpportunities();
    const filtered = !query ? all : all.filter((o) => o.name.toLowerCase().includes(query));
    return toOpenUiListResult(filtered);
  },
  get_opportunity: async (_scope, args) => {
    const row = await getOpportunity(String(args.id ?? ""));
    return row ? toOpenUiOpportunityCard(row) : null;
  },
  advance_opportunity_stage: async (scope, args) => {
    const id = String(args.id ?? "");
    const opportunityName = String(args.opportunityName ?? "");
    const toStage = String(args.toStage ?? "");
    const label = STAGE_LABELS.get(toStage as (typeof PIPELINE_STAGES)[number]["value"]);
    if (!label) return { ok: false, error: `unknown stage "${toStage}"` };

    const existing = await getOpportunity(id);
    const previousStage = existing?.stage ?? null;

    const result = await updateOpportunityStage(id, toStage as (typeof PIPELINE_STAGES)[number]["value"]);
    if (result.ok) {
      await writeAudit(scope, {
        actorType: "agent",
        action: "opportunity.stage_changed",
        entityType: "opportunity",
        before: { stage: previousStage },
        after: { stage: toStage, opportunityName },
      });
    }
    return result;
  },
};

function bindScopedHandlers(handlers: Record<string, ScopedToolHandler>): ToolProviderMap {
  return Object.fromEntries(
    Object.entries(handlers).map(([name, fn]) => [
      name,
      (args: Record<string, unknown>) => {
        const orgId = process.env.ADS_AGENT_ORG_ID;
        if (!orgId) throw new Error("ADS_AGENT_ORG_ID is not set");
        return fn(scopeForJob(orgId), args);
      },
    ]),
  );
}

/**
 * Server-side OpenUI toolProvider map. Client reaches these only via createHttpToolProvider →
 * POST /api/openui/tools (MCP stays on the backend inside listOpportunities/getOpportunity).
 * Official OpenUI Generate→Execute: the LLM emits Query("list_opportunities"); the Renderer runs
 * the tool — data never round-trips through the model as OpportunityCard positionals.
 * @see https://www.openui.com/docs/openui-lang/how-it-works
 */
export const crmToolProvider: ToolProviderMap = bindScopedHandlers(crmToolHandlers);

/** Read-only specs for CRM Assistant / Copilot prompts (mutations stay Confirm→PATCH). */
export const crmReadToolSpecs: ToolSpec[] = [
  {
    name: "list_opportunities",
    description:
      "List every open CRM opportunity/lead. Returns {opportunities: OpportunityCardRow[]} where each row is " +
      "{name, stage, tier, amountLabel, maskedPhone, source}. Wire as: " +
      'list = Query("list_opportunities", {}, {opportunities: []}); OpportunityList(list.opportunities).',
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: {
      type: "object",
      properties: { opportunities: { type: "array" } },
      required: ["opportunities"],
    },
  },
  {
    name: "search_opportunities",
    description:
      "Search CRM opportunities by case-insensitive name substring. Same {opportunities: [...]} envelope as list_opportunities.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Name substring to search for" } },
      required: ["query"],
    },
    outputSchema: {
      type: "object",
      properties: { opportunities: { type: "array" } },
      required: ["opportunities"],
    },
  },
  {
    name: "get_opportunity",
    description: "Get one CRM opportunity by id as an OpenUI OpportunityCard row, or null.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    outputSchema: { type: "object" },
  },
];

export const crmToolSpecs: ToolSpec[] = [
  ...crmReadToolSpecs,
  {
    name: "advance_opportunity_stage",
    description:
      `Move an opportunity to a new pipeline stage. Valid toStage values: ${PIPELINE_STAGES.map((s) => s.value).join(", ")}. ` +
      "ALWAYS render StageChangeConfirm first and wait for the user's explicit confirmation before calling this.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        opportunityName: { type: "string", description: "Human-readable name, for the audit log" },
        toStage: { type: "string" },
      },
      required: ["id", "opportunityName", "toStage"],
    },
    outputSchema: { type: "object" },
  },
];
