import { listCampaigns } from "../db/campaigns";
import { createProposal } from "../db/proposals";
import { recordCrmSignalSnapshot, recordPerformanceSnapshot, recentPerformanceSnapshots } from "../db/snapshots";
import { logAiAction } from "../db/ai-action-log";
import { fetchGoogleAdsPerformance, fetchGoogleSearchTerms } from "../connectors/google-ads";
import { fetchMetaPerformance } from "../connectors/meta";
import { fetchLeadSignal } from "../connectors/twenty";
import { evaluateRules, type SearchTermRow } from "./rules";
import { draftRationale } from "./rationale";
import { STRATEGY } from "./strategy-config";

export async function runDecisionCycle(): Promise<{ proposalsCreated: number }> {
  const campaigns = await listCampaigns();
  const byExternalId = new Map(
    campaigns.filter((c) => c.externalId !== null).map((c) => [c.externalId as string, c]),
  );

  const [googlePerformance, metaPerformance, googleSearchTerms, leadSignal] = await Promise.all([
    fetchGoogleAdsPerformance(),
    fetchMetaPerformance(),
    fetchGoogleSearchTerms(),
    fetchLeadSignal(),
  ]);

  for (const row of [...googlePerformance, ...metaPerformance]) {
    const campaign = byExternalId.get(row.externalCampaignId);
    if (!campaign) continue;
    await recordPerformanceSnapshot({
      campaignId: campaign.id,
      spend: row.spend,
      clicks: row.clicks,
      impressions: row.impressions,
      conversions: row.conversions,
      raw: row,
    });
  }

  // Budget-reallocation rules need per-campaign CRM signals; they won't fire until attribution exists.
  await recordCrmSignalSnapshot({ campaignId: null, ...leadSignal });

  const searchTerms: SearchTermRow[] = googleSearchTerms
    .map((row) => {
      const campaign = byExternalId.get(row.externalCampaignId);
      return campaign
        ? { campaignId: campaign.id, searchTerm: row.searchTerm, clicks: row.clicks, conversions: row.conversions }
        : null;
    })
    .filter((row): row is SearchTermRow => row !== null);

  const recentSnapshots = await recentPerformanceSnapshots(3);
  const newProposals = evaluateRules(
    {
      campaigns,
      recentSnapshots,
      recentSignals: [{ ...leadSignal, id: "", campaignId: null, capturedAt: new Date().toISOString() }],
      searchTerms,
    },
    STRATEGY,
  );

  let proposalsCreated = 0;
  for (const proposal of newProposals) {
    const rationale = await draftRationale(proposal);
    await createProposal({ ...proposal, rationale });
    proposalsCreated++;
  }

  if (proposalsCreated > 0) {
    await logAiAction({
      domain: "marketing",
      summary: `Created ${proposalsCreated} proposal${proposalsCreated === 1 ? "" : "s"}`,
    });
  }

  return { proposalsCreated };
}
