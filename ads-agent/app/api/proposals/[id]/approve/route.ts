import { NextResponse } from "next/server";
import { guard, ownedOr404 } from "@/lib/auth/guard";
import { getCampaignById } from "@/lib/db/campaigns";
import { getOrgSettings } from "@/lib/db/org-settings";
import { getProposalById, scheduleProposal } from "@/lib/db/proposals";
import { budgetDeltaInr } from "@/lib/decision-engine/budget-delta";
import { brokerRationale } from "@/lib/decision-engine/broker-rationale";
import { runPreflight } from "@/lib/decision-engine/preflight";
import { semanticDiff } from "@/lib/decision-engine/semantic-diff";
import { getConnectorStatus } from "@/lib/env-status";
import { getOrgBalance } from "@/lib/metering/ledger";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope } = access;
  const { id } = await params;

  const owned = await ownedOr404((s) => getProposalById(s, id), scope);
  if (!owned.ok) return owned.response;
  const proposal = owned.entity;
  if (proposal.status !== "pending") {
    return NextResponse.json(
      { error: `proposal is ${proposal.status}, not pending` },
      { status: 409 },
    );
  }

  const campaign = proposal.campaignId
    ? await getCampaignById(scope, proposal.campaignId)
    : null;

  const payload =
    proposal.payload.platform == null && campaign?.platform
      ? { ...proposal.payload, platform: campaign.platform }
      : proposal.payload;

  const [settings, creditBalance] = await Promise.all([
    getOrgSettings(scope),
    getOrgBalance(scope.orgId),
  ]);
  const connectors = getConnectorStatus();

  const preflight = runPreflight({
    kind: proposal.kind,
    payload,
    orgDailyBudgetCapInr: settings.approvalThresholdInr,
    creditBalance,
    connectors: { googleAds: connectors.googleAds, meta: connectors.meta },
  });

  if (!preflight.ok) {
    return NextResponse.json({ error: "preflight_failed", preflight }, { status: 422 });
  }

  const scheduled = await scheduleProposal(scope, id, {
    decidedBy: access.session.userId,
    decidedVia: "ui",
    undoWindowSeconds: settings.undoWindowSeconds,
  });

  if (!scheduled) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const live = campaign
    ? {
        dailyBudgetInr: campaign.dailyBudget,
        status: campaign.status,
        name: campaign.name,
      }
    : undefined;

  return NextResponse.json({
    ok: true,
    proposal: scheduled,
    preflight,
    diff: semanticDiff({ kind: proposal.kind, payload, live }),
    brokerCopy: brokerRationale({
      kind: proposal.kind,
      payload,
      triggeredRule: proposal.triggeredRule,
    }),
    budgetDeltaInr: budgetDeltaInr({
      kind: proposal.kind,
      payload,
      currentDailyBudgetInr: campaign?.dailyBudget ?? null,
    }),
  });
}
