import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { suppressEnquiry } from "@/lib/db/erasure";

/**
 * "Delete" from the user's point of view. Suppression, not DELETE: DPDP Rule
 * 8(3) requires a one-year retention floor even after the subject deletes
 * their account, so a real delete here would be non-compliant.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("admin");
  if (!access.ok) return access.response;
  const { scope, session } = access;
  const { id } = await params;

  const result = await suppressEnquiry(scope, id, session.userId);
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ suppressed: true, deletionRequestId: result.requestId });
}
