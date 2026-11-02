import type { Scope } from "@/lib/db/scope-sql";
import { fetchGoogleAdsPerformance, fetchGoogleSearchTerms } from "../connectors/google-ads";
import { fetchMetaPerformance } from "../connectors/meta";
import { fetchLeadSignal } from "../crm/twenty-pipeline";
import { listCampaigns } from "../db/campaigns";
import { createProposal } from "../db/proposals";
import { writeAudit } from "../db/audit-log";
import { recordCrmSignalSnapshot, recordPerformanceSnapshot, recentPerformanceSnapshots } from "../db/snapshots";
import { draftRationale } from "./rationale";
import {
  reallocateListing,
  type ReallocateListingInput,
  type ReallocateMove,
} from "../monitor/reallocate";
import { evaluateRules, type SearchTermRow } from "./rules";
import { STRATEGY } from "./strategy-config";

export type DecisionCycleOptions = {
  shareMoves?: ReallocateListingInput[];
  applyMove?: (result: ReallocateMove) => void | Promise<void>;
};

export type DecisionCycleResult = {
  proposalsCreated: number;
  shareMoves: { failed: number; moved: number };
  shareMoveDecisions?: ReallocateMove[];
  failedShareMoves?: { error: string; move: ReallocateMove }[];
};

const EMPTY_LEAD_SIGNAL = { hotCount: 0, warmCount: 0, coldCount: 0, unscoredCount: 0 };

/** One platform's fetch failing (e.g. the Google Ads MCP server unreachable) must not abort every
 * other platform's snapshot for this tick — matches fetchLeadSignal's existing internal soft-fail
 * (lib/crm/twenty-pipeline.ts), applied here per-source instead of per-connector. */
async function softFail<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`ads-agent cycle: ${label} fetch failed, skipping for this tick`, err);
    return fallback;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runDecisionCycle(
  scope: Scope,
  options?: DecisionCycleOptions,
): Promise<DecisionCycleResult> {
  const campaigns = await listCampaigns(scope);
  const byExternalId = new Map(
    campaigns.filter((c) => c.externalId !== null).map((c) => [c.externalId as string, c]),
  );

  const leadSignal = await softFail("twenty lead signal", () => fetchLeadSignal(scope), EMPTY_LEAD_SIGNAL);

  const [googlePerformance, metaPerformance, googleSearchTerms] = await Promise.all([
    softFail("google ads performance", fetchGoogleAdsPerformance, []),
    softFail("meta performance", fetchMetaPerformance, []),
    softFail("google ads search terms", fetchGoogleSearchTerms, []),
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

  const shareMoveStats = { failed: 0, moved: 0 };
  const shareMoveDecisions: ReallocateMove[] = [];
  const failedShareMoves: { error: string; move: ReallocateMove }[] = [];

  for (const input of options?.shareMoves ?? []) {
    const result = reallocateListing(input);
    if (result.action === "skip") {
      continue;
    }
    if (!options?.applyMove) {
      shareMoveDecisions.push(result);
      continue;
    }
    try {
      await options.applyMove(result);
      shareMoveStats.moved += 1;
    } catch (err) {
      const error = errorMessage(err);
      shareMoveStats.failed += 1;
      failedShareMoves.push({ error, move: result });
      await writeAudit(scope, {
        actorType: "agent",
        action: "cycle.share_move",
        entityType: "cycle",
        after: { outcome: "failed", error, move: result },
      });
    }
  }

  if (scope.kind === "platform") {
    await recordCrmSignalSnapshot(scope, { campaignId: null, ...leadSignal });
  }

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

  return {
    proposalsCreated,
    shareMoves: shareMoveStats,
    ...(shareMoveDecisions.length > 0 ? { shareMoveDecisions } : {}),
    ...(failedShareMoves.length > 0 ? { failedShareMoves } : {}),
  };
}
