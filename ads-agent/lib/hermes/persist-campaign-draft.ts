import { getDraftById, setDraftStatus, updateDraftFields } from "@/lib/db/campaign-drafts";
import { isDraftReady, validateDraftFields } from "@/lib/decision-engine/campaign-draft-rules";
import { parseSetupCardResponse, type SetupCardProps } from "@/lib/openui/campaign-library";
import type { CampaignDraft, CampaignDraftFields } from "@/lib/types";
import type { Scope } from "@/lib/db/scope-sql";

function setupCardPropsToFieldUpdates(props: SetupCardProps): CampaignDraftFields {
  return {
    corridor: props.corridor === "" ? null : props.corridor,
    dailyBudgetInr: props.dailyBudgetInr === 0 ? null : props.dailyBudgetInr,
    adGroupName: props.adGroupName === "" ? null : props.adGroupName,
    keywords: props.keywords,
    headlines: props.headlines,
    descriptions: props.descriptions,
    finalUrl: props.finalUrl,
  };
}

/** Parses a Hermes campaign reply for SetupCard field updates (same shape as Bifrost /messages). */
export function fieldUpdatesFromHermesReply(reply: string): CampaignDraftFields | null {
  const parsed = parseSetupCardResponse(reply);
  if (parsed.kind !== "ok") return null;
  const fields = setupCardPropsToFieldUpdates(parsed.props);
  if (validateDraftFields(fields).length > 0) return null;
  return fields;
}

export async function persistCampaignDraftFromHermesReply(
  scope: Scope,
  draftId: string,
  reply: string,
  currentDraft: CampaignDraft,
): Promise<CampaignDraft> {
  const fieldUpdates = fieldUpdatesFromHermesReply(reply);
  if (!fieldUpdates) return currentDraft;

  const updated = await updateDraftFields(scope, draftId, fieldUpdates);
  await setDraftStatus(scope, draftId, isDraftReady(updated) ? "ready" : "chatting");
  return (await getDraftById(scope, draftId)) ?? updated;
}
