import { NextResponse } from "next/server";
import { guard, ownedOr404 } from "@/lib/auth/guard";
import { cancelScheduledProposal, getProposalById } from "@/lib/db/proposals";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope } = access;
  const { id } = await params;

  const owned = await ownedOr404((s) => getProposalById(s, id), scope);
  if (!owned.ok) return owned.response;
  if (owned.entity.status !== "scheduled") {
    return NextResponse.json(
      { error: `proposal is ${owned.entity.status}, not scheduled` },
      { status: 409 },
    );
  }

  const proposal = await cancelScheduledProposal(scope, id);
  if (!proposal) {
    return NextResponse.json({ error: "undo window elapsed" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, proposal });
}
