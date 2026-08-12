import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { getDraftById, setDraftStatus, updateDraftFields } from "@/lib/db/campaign-drafts";
import { isDraftReady, validateDraftFields } from "@/lib/decision-engine/campaign-draft-rules";
import type { CampaignDraftFields } from "@/lib/types";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const { id } = await params;
  const existing = await getDraftById(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.status === "converted") {
    return NextResponse.json({ error: "draft already converted to a proposal" }, { status: 409 });
  }

  const fields = (await req.json()) as CampaignDraftFields;
  const validationErrors = validateDraftFields(fields);
  if (validationErrors.length > 0) {
    return NextResponse.json({ error: validationErrors.join("; ") }, { status: 422 });
  }

  const updated = await updateDraftFields(id, fields);
  await setDraftStatus(id, isDraftReady(updated) ? "ready" : "chatting");
  const draft = await getDraftById(id);
  return NextResponse.json({ draft });
}
