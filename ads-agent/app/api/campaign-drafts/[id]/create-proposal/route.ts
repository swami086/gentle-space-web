import { NextResponse } from "next/server";
import { guard, ownedOr404 } from "@/lib/auth/guard";
import { getDraftById, markDraftConverted } from "@/lib/db/campaign-drafts";
import { createProposal } from "@/lib/db/proposals";
import { proposeCampaignCreation } from "@/lib/decision-engine/rules";
import { STRATEGY } from "@/lib/decision-engine/strategy-config";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope } = access;
  const { id } = await params;

  const owned = await ownedOr404((s) => getDraftById(s, id), scope);
  if (!owned.ok) return owned.response;
  if (owned.entity.status !== "ready") {
    return NextResponse.json({ error: `draft is ${owned.entity.status}, not ready` }, { status: 409 });
  }

  const draft = owned.entity;
  const newProposal = proposeCampaignCreation(
    {
      corridor: draft.corridor!,
      platform: "google",
      dailyBudgetInr: draft.dailyBudgetInr!,
      adGroupName: draft.adGroupName!,
      keywords: draft.keywords,
      headlines: draft.headlines,
      descriptions: draft.descriptions,
      finalUrl: draft.finalUrl,
    },
    STRATEGY,
  );

  const proposal = await createProposal(scope, newProposal);
  await markDraftConverted(scope, id, proposal.id);
  return NextResponse.json({ proposalId: proposal.id });
}
