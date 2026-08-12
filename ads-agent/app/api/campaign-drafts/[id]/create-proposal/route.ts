import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeForSession } from "@/lib/auth/scope-interim";
import { getDraftById, markDraftConverted } from "@/lib/db/campaign-drafts";
import { createProposal } from "@/lib/db/proposals";
import { proposeCampaignCreation } from "@/lib/decision-engine/rules";
import { STRATEGY } from "@/lib/decision-engine/strategy-config";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const scope = await scopeForSession(access.session);
  const { id } = await params;
  const draft = await getDraftById(scope, id);
  if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (draft.status !== "ready") {
    return NextResponse.json({ error: `draft is ${draft.status}, not ready` }, { status: 409 });
  }

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
