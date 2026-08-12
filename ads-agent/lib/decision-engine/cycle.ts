import type { Scope } from "@/lib/db/scope-sql";
import { listCampaigns } from "../db/campaigns";
import { createProposal } from "../db/proposals";
import { recordCrmSignalSnapshot, recordPerformanceSnapshot, recentPerformanceSnapshots } from "../db/snapshots";
import { writeAudit } from "../db/audit-log";
import { fetchGoogleAdsPerformance, fetchGoogleSearchTerms } from "../connectors/google-ads";
import { fetchMetaPerformance } from "../connectors/meta";
import { fetchLeadSignal } from "../connectors/twenty";
import { evaluateRules, type SearchTermRow } from "./rules";
import { draftRationale } from "./rationale";
import { STRATEGY } from "./strategy-config";

/** One platform's fetch failing (e.g. the Google Ads MCP server unreachable) must not abort every
 * other platform's snapshot for this tick — matches fetchLeadSignal's existing internal soft-fail
 * (lib/connectors/twenty.ts), applied here per-source instead of per-connector. */
async function softFail<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`ads-agent cycle: ${label} fetch failed, skipping for this tick`, err);
    return fallback;
  }
}

export async function runDecisionCycle(scope: Scope): Promise<{ proposalsCreated: number }> {
  const campaigns = await listCampaigns(scope);
  const byExternalId = new Map(
    campaigns.filter((c) => c.externalId !== null).map((c) => [c.externalId as string, c]),
  );

  const [googlePerformance, metaPerformance, googleSearchTerms, leadSignal] = await Promise.all([
    softFail("google ads performance", fetchGoogleAdsPerformance, []),
    softFail("meta performance", fetchMetaPerformance, []),
    softFail("google ads search terms", fetchGoogleSearchTerms, []),
    fetchLeadSignal(),
  ]);

  for (const row of [...googlePerformance, ...metaPerformance]) {
    const campaign = byExternalId.get(row.externalCampaignId);
    if (!campaign) continue;
    await recordPerformanceSnapshot(scope, {
      campaignId: campaign.id,
      spend: row.spend,
      clicks: row.clicks,
      impressions: row.impressions,
      conversions: row.conversions,
      raw: row,
    });
  }

  // Budget-reallocation rules need per-campaign CRM signals; they won't fire until attribution exists.
  await recordCrmSignalSnapshot(scope, { campaignId: null, ...leadSignal });

  const searchTerms: SearchTermRow[] = googleSearchTerms
    .map((row) => {
      const campaign = byExternalId.get(row.externalCampaignId);
      return campaign
        ? { campaignId: campaign.id, searchTerm: row.searchTerm, clicks: row.clicks, conversions: row.conversions }
        : null;
    })
    .filter((row): row is SearchTermRow => row !== null);

  const recentSnapshots = await recentPerformanceSnapshots(scope, 3);
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
    await createProposal(scope, { ...proposal, rationale });
    proposalsCreated++;
  }

  if (proposalsCreated > 0) {
    const summary = `Created ${proposalsCreated} proposal${proposalsCreated === 1 ? "" : "s"}`;
    await writeAudit(scope, {
      actorType: "agent",
      action: "cycle.run",
      entityType: "cycle",
      after: { proposalsCreated, summary },
    });
  }

  return { proposalsCreated };
}
