import { NextResponse } from "next/server";
import { guard, ownedOr404 } from "@/lib/auth/guard";
import { getProposalById, updateProposalPayload } from "@/lib/db/proposals";
import { validateDraftFields } from "@/lib/decision-engine/campaign-draft-rules";
import type { CampaignDraftFields } from "@/lib/types";

const EDITABLE_FIELDS = ["dailyBudgetInr", "adGroupName", "keywords", "headlines", "descriptions", "finalUrl"] as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope } = access;
  const { id } = await params;

  const owned = await ownedOr404((s) => getProposalById(s, id), scope);
  if (!owned.ok) return owned.response;
  if (owned.entity.kind !== "create_campaign") {
    return NextResponse.json({ error: "only create_campaign proposals are editable" }, { status: 400 });
  }
  if (owned.entity.status !== "pending") {
    return NextResponse.json({ error: `proposal is ${owned.entity.status}, not pending` }, { status: 409 });
  }

  const patch = (await req.json()) as CampaignDraftFields;
  const validationErrors = validateDraftFields(patch);
  if (validationErrors.length > 0) {
    return NextResponse.json({ error: validationErrors.join("; ") }, { status: 422 });
  }

  const nextPayload: Record<string, unknown> = { ...owned.entity.payload };
  for (const field of EDITABLE_FIELDS) {
    if (patch[field] !== undefined) nextPayload[field] = patch[field];
  }

  const updated = await updateProposalPayload(scope, id, nextPayload);
  return NextResponse.json({ payload: updated.payload });
}
