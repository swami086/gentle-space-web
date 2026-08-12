import type { ToolSpec } from "@openuidev/lang-core";
import { scopeForJob } from "@/lib/auth/scope-interim";
import { createDraft } from "../db/campaign-drafts";
import type { Scope } from "../db/scope-sql";
import type { ToolProviderMap } from "./platform-tools";

type ScopedToolHandler = (scope: Scope, args: Record<string, unknown>) => Promise<unknown>;

/** Campaign-domain tools for the global Copilot (Spec 1 chat remains the rich setup surface). */
export const campaignToolHandlers: Record<string, ScopedToolHandler> = {
  start_campaign_draft: async (scope) => {
    const draft = await createDraft(scope);
    return { id: draft.id, path: `/campaigns/drafts/${draft.id}` };
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

export const campaignToolProvider: ToolProviderMap = bindScopedHandlers(campaignToolHandlers);

export const campaignToolSpecs: ToolSpec[] = [
  {
    name: "start_campaign_draft",
    description:
      "Create a new campaign draft and return { id, path }. Use when the user asks to create, start, " +
      "or sample a campaign. After calling, reply with a short plain acknowledgment under 120 chars " +
      "that includes the returned path so they can open Campaign Chat.",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "object" },
  },
];
