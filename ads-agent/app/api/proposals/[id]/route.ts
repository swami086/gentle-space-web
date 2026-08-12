import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { getProposalById, updateProposalPayload } from "@/lib/db/proposals";
import { validateDraftFields } from "@/lib/decision-engine/campaign-draft-rules";
import type { CampaignDraftFields } from "@/lib/types";

const EDITABLE_FIELDS = ["dailyBudgetInr", "adGroupName", "keywords", "headlines", "descriptions", "finalUrl"] as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const { id } = await params;
  const proposal = await getProposalById(id);
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (proposal.kind !== "create_campaign") {
    return NextResponse.json({ error: "only create_campaign proposals are editable" }, { status: 400 });
  }
  if (proposal.status !== "pending") {
    return NextResponse.json({ error: `proposal is ${proposal.status}, not pending` }, { status: 409 });
  }

  const patch = (await req.json()) as CampaignDraftFields;
  const validationErrors = validateDraftFields(patch);
  if (validationErrors.length > 0) {
    return NextResponse.json({ error: validationErrors.join("; ") }, { status: 422 });
  }

  const nextPayload: Record<string, unknown> = { ...proposal.payload };
  for (const field of EDITABLE_FIELDS) {
    if (patch[field] !== undefined) nextPayload[field] = patch[field];
  }

  const updated = await updateProposalPayload(id, nextPayload);
  return NextResponse.json({ payload: updated.payload });
}
