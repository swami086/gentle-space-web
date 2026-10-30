import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { probeGoogleAdsReadMcp } from "@/lib/connectors/google-ads-health";
import { partitionBulkIds, type BulkItemResult } from "@/lib/decision-engine/bulk-decide";
import { runPreflight } from "@/lib/decision-engine/preflight";
import { getCampaignById } from "@/lib/db/campaigns";
import { getOrgSettings } from "@/lib/db/org-settings";
import { decideProposal, getProposalById, scheduleProposal } from "@/lib/db/proposals";
import { getConnectorStatus } from "@/lib/env-status";
import { getOrgBalance } from "@/lib/metering/ledger";

type BulkBody = { action?: unknown; ids?: unknown };

function normalizeIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((id) => (typeof id === "string" ? id.toLowerCase() : ""));
}

export async function POST(req: Request) {
  const access = await guard("operator");
  if (!access.ok) return access.response;

  let body: BulkBody;
  try {
    body = (await req.json()) as BulkBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
  }

  const normalized = normalizeIds(body.ids);
  if (normalized === null || normalized.some((id) => !id)) {
    return NextResponse.json({ error: "ids must be an array of strings" }, { status: 400 });
  }

  const partitioned = partitionBulkIds(normalized);
  if ("error" in partitioned) {
    return NextResponse.json({ error: partitioned.error }, { status: 400 });
  }

  const { scope } = access;
  const userId = access.session.userId;
  const results: BulkItemResult[] = [];
  const batchId = body.action === "approve" ? randomUUID() : null;

  let undoWindowSeconds = 0;
  let approvalThresholdInr: number | null = null;
  let creditBalance = 0;
  let connectors = { googleAds: false, meta: false };
  let googleAdsReachable = false;
  if (body.action === "approve") {
    const [settings, balance, health] = await Promise.all([
      getOrgSettings(scope),
      getOrgBalance(scope.orgId),
      probeGoogleAdsReadMcp({ timeoutMs: 2000 }),
    ]);
    undoWindowSeconds = settings.undoWindowSeconds;
    approvalThresholdInr = settings.approvalThresholdInr;
    creditBalance = balance;
    connectors = getConnectorStatus();
    googleAdsReachable = health.configured && health.reachable;
  }

  for (const id of partitioned.ok) {
    try {
      const proposal = await getProposalById(scope, id);
      if (!proposal) {
        results.push({ id, ok: false, error: "not found" });
        continue;
      }
      if (proposal.status !== "pending") {
        results.push({ id, ok: false, error: `proposal is ${proposal.status}, not pending` });
        continue;
      }

      if (body.action === "approve") {
        const campaign = proposal.campaignId ? await getCampaignById(scope, proposal.campaignId) : null;
        const payload =
          proposal.payload.platform == null && campaign?.platform
            ? { ...proposal.payload, platform: campaign.platform }
            : proposal.payload;
        const preflight = runPreflight({
          kind: proposal.kind,
          payload,
          orgDailyBudgetCapInr: approvalThresholdInr,
          creditBalance,
          connectors: {
            googleAds: connectors.googleAds,
            googleAdsReachable,
            meta: connectors.meta,
          },
        });
        if (!preflight.ok) {
          results.push({ id, ok: false, error: "preflight_failed" });
          continue;
        }
        const scheduled = await scheduleProposal(scope, id, {
          decidedBy: userId,
          decidedVia: "bulk",
          undoWindowSeconds,
          batchId,
        });
        if (!scheduled) {
          results.push({ id, ok: false, error: "could not schedule" });
          continue;
        }
        results.push({ id, ok: true, status: "scheduled" });
      } else {
        await decideProposal(scope, id, "rejected", userId, "bulk");
        results.push({ id, ok: true, status: "rejected" });
      }
    } catch (err) {
      results.push({
        id,
        ok: false,
        error: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  return NextResponse.json({ batchId, results });
}
