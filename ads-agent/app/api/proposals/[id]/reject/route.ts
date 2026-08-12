import { NextResponse } from "next/server";
import { guard, ownedOr404 } from "@/lib/auth/guard";
import { decideProposal, getProposalById } from "@/lib/db/proposals";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope } = access;
  const { id } = await params;

  const owned = await ownedOr404((s) => getProposalById(s, id), scope);
  if (!owned.ok) return owned.response;
  if (owned.entity.status !== "pending") {
    return NextResponse.json(
      { error: `proposal is ${owned.entity.status}, not pending` },
      { status: 409 },
    );
  }

  await decideProposal(scope, id, "rejected", access.session.userId, "ui");
  return NextResponse.json({ ok: true });
}
