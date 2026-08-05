import type { ToolSpec } from "@openuidev/lang-core";
import { createDraft } from "../db/campaign-drafts";
import type { ToolProviderMap } from "./platform-tools";

/** Campaign-domain tools for the global Copilot (Spec 1 chat remains the rich setup surface). */
export const campaignToolProvider: ToolProviderMap = {
  start_campaign_draft: async () => {
    const draft = await createDraft();
    return { id: draft.id, path: `/campaigns/drafts/${draft.id}` };
  },
};

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
