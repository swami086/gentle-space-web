import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeForSession } from "@/lib/auth/scope-interim";
import { decideProposal, getProposalById } from "@/lib/db/proposals";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;
  const scope = await scopeForSession(access.session);
  const { id } = await params;
  const proposal = await getProposalById(scope, id);
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (proposal.status !== "pending") {
    return NextResponse.json({ error: `proposal is ${proposal.status}, not pending` }, { status: 409 });
  }

  await decideProposal(scope, id, "rejected", access.session.userId, "ui");
  return NextResponse.json({ ok: true });
}
