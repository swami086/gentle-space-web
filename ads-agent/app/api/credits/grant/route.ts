import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { grantCredits } from "@/lib/metering/ledger";

export async function POST(req: Request) {
  const access = await guard("admin");
  if (!access.ok) return access.response;

  const body = (await req.json()) as {
    userId?: unknown;
    amountCredits?: unknown;
    note?: unknown;
  };
  if (typeof body.amountCredits !== "number" || !(body.amountCredits > 0)) {
    return NextResponse.json({ error: "amountCredits must be a positive number" }, { status: 400 });
  }
  await grantCredits({
    orgId: access.scope.orgId,
    userId: typeof body.userId === "string" && body.userId ? body.userId : undefined,
    amountCredits: body.amountCredits,
    grantedBy: access.session.email,
    note: typeof body.note === "string" && body.note ? body.note : undefined,
  });
  return NextResponse.json({ ok: true });
}
