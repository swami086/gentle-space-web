import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getEnquiryById } from "@/lib/db/enquiries";
import { CALL_OUTCOMES, logCall, type CallOutcome } from "@/lib/db/enquiry-activities";

type CallBody = {
  outcome?: unknown;
  direction?: unknown;
  seconds?: unknown;
  occurredAt?: unknown;
  notes?: unknown;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope, session } = access;
  const { id } = await params;

  let body: CallBody;
  try {
    body = (await req.json()) as CallBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (typeof body.outcome !== "string" || !CALL_OUTCOMES.includes(body.outcome as CallOutcome)) {
    return NextResponse.json(
      { error: `outcome must be one of ${CALL_OUTCOMES.join(", ")}` },
      { status: 400 },
    );
  }
  if (body.direction !== "outgoing" && body.direction !== "incoming") {
    return NextResponse.json({ error: "direction must be outgoing or incoming" }, { status: 400 });
  }
  const seconds = Number(body.seconds);
  if (!Number.isInteger(seconds) || seconds < 0) {
    return NextResponse.json({ error: "seconds must be a whole number, zero or more" }, { status: 400 });
  }
  if (typeof body.occurredAt !== "string" || Number.isNaN(Date.parse(body.occurredAt))) {
    return NextResponse.json({ error: "occurredAt must be an ISO timestamp" }, { status: 400 });
  }

  if (!(await getEnquiryById(scope, id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const activity = await logCall(scope, {
    enquiryId: id,
    actorUserId: session.userId,
    outcome: body.outcome as CallOutcome,
    direction: body.direction,
    seconds,
    occurredAt: body.occurredAt,
    body: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
  });
  return NextResponse.json({ activity }, { status: 201 });
}
