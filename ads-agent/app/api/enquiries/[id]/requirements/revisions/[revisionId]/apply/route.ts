import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getEnquiryById } from "@/lib/db/enquiries";
import { applyRevision } from "@/lib/db/enquiry-requirements";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; revisionId: string }> },
) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope, session } = access;
  const { id, revisionId } = await params;

  if (!(await getEnquiryById(scope, id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // The session user is the confirming human. applyRevision refuses an empty
  // one, and a check constraint refuses an applied revision with no confirmer.
  const requirement = await applyRevision(scope, revisionId, session.userId);
  if (!requirement) {
    return NextResponse.json({ error: "not found or already applied" }, { status: 404 });
  }
  return NextResponse.json({ requirement });
}
