import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getEnquiryById } from "@/lib/db/enquiries";
import { createRevision } from "@/lib/db/enquiry-requirements";
import { extractRequirementDiff } from "@/lib/enquiries/requirement-extraction";

/**
 * Proposes; never applies (C3). The screen shows the returned diff as chips
 * with an explicit "Update the requirement" button, which calls the apply
 * route. This handler deliberately avoids the live-requirement write path.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope } = access;
  const { id } = await params;

  let notes: unknown;
  try {
    ({ notes } = (await req.json()) as { notes?: unknown });
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof notes !== "string" || !notes.trim()) {
    return NextResponse.json({ error: "notes is required" }, { status: 400 });
  }

  if (!(await getEnquiryById(scope, id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const proposed = await extractRequirementDiff(notes);
  if (Object.keys(proposed).length === 0) {
    return NextResponse.json({ revision: null, proposed: {} });
  }

  const revision = await createRevision(scope, { enquiryId: id, source: "call_notes", proposed });
  return NextResponse.json({ revision, proposed }, { status: 201 });
}
