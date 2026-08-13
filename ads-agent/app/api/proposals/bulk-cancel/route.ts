import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { cancelScheduledBatch } from "@/lib/db/proposals";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function POST(req: Request) {
  const access = await guard("operator");
  if (!access.ok) return access.response;

  const body = (await req.json()) as { batchId?: unknown };
  if (typeof body.batchId !== "string") {
    return NextResponse.json({ error: "batchId must be a string" }, { status: 400 });
  }

  const batchId = body.batchId.toLowerCase();
  if (!UUID.test(batchId)) {
    return NextResponse.json({ error: "invalid batchId" }, { status: 400 });
  }

  const canceled = await cancelScheduledBatch(access.scope, batchId);
  return NextResponse.json({ canceled });
}
