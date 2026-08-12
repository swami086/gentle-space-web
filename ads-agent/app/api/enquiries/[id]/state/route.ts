import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { REPLY_STATES, setReplyState, type ReplyState } from "@/lib/db/enquiries";
import { logStateChange } from "@/lib/db/enquiry-activities";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope, session } = access;
  const { id } = await params;

  let replyState: unknown;
  try {
    ({ replyState } = (await req.json()) as { replyState?: unknown });
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof replyState !== "string" || !REPLY_STATES.includes(replyState as ReplyState)) {
    return NextResponse.json(
      { error: `replyState must be one of ${REPLY_STATES.join(", ")}` },
      { status: 400 },
    );
  }

  const enquiry = await setReplyState(scope, id, replyState as ReplyState);
  if (!enquiry) return NextResponse.json({ error: "not found" }, { status: 404 });

  await logStateChange(scope, {
    enquiryId: id,
    actorUserId: session.userId,
    body: `Reply state set to ${replyState}`,
  });
  return NextResponse.json({ enquiry });
}
