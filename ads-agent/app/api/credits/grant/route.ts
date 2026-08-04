import { NextResponse } from "next/server";
import { grantCredits } from "@/lib/metering/ledger";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    orgId?: unknown;
    userId?: unknown;
    amountCredits?: unknown;
    note?: unknown;
  };
  if (typeof body.orgId !== "string" || !body.orgId) {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  }
  if (typeof body.amountCredits !== "number" || !(body.amountCredits > 0)) {
    return NextResponse.json({ error: "amountCredits must be a positive number" }, { status: 400 });
  }
  await grantCredits({
    orgId: body.orgId,
    userId: typeof body.userId === "string" && body.userId ? body.userId : undefined,
    amountCredits: body.amountCredits,
    grantedBy: "admin", // no auth system yet — see design spec Non-goals
    note: typeof body.note === "string" && body.note ? body.note : undefined,
  });
  return NextResponse.json({ ok: true });
}
