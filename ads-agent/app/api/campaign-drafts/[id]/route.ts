import { NextResponse } from "next/server";
import { guard, ownedOr404 } from "@/lib/auth/guard";
import { getDraftById, setDraftStatus, updateDraftFields } from "@/lib/db/campaign-drafts";
import { isDraftReady, validateDraftFields } from "@/lib/decision-engine/campaign-draft-rules";
import type { CampaignDraftFields } from "@/lib/types";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope } = access;
  const { id } = await params;

  const owned = await ownedOr404((s) => getDraftById(s, id), scope);
  if (!owned.ok) return owned.response;
  if (owned.entity.status === "converted") {
    return NextResponse.json({ error: "draft already converted to a proposal" }, { status: 409 });
  }

  const fields = (await req.json()) as CampaignDraftFields;
  const validationErrors = validateDraftFields(fields);
  if (validationErrors.length > 0) {
    return NextResponse.json({ error: validationErrors.join("; ") }, { status: 422 });
  }

  const updated = await updateDraftFields(scope, id, fields);
  await setDraftStatus(scope, id, isDraftReady(updated) ? "ready" : "chatting");
  const draft = await getDraftById(scope, id);
  return NextResponse.json({ draft });
}
