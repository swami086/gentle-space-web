import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { createReminder, listPendingReminders } from "@/lib/db/reminders";

export async function GET() {
  const access = await guard("viewer");
  if (!access.ok) return access.response;
  const { scope, session } = access;
  const reminders = await listPendingReminders(scope, { userId: session.userId });
  return NextResponse.json({ reminders });
}

export async function POST(req: Request) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope, session } = access;

  let body: { enquiryId?: unknown; dueAt?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.dueAt !== "string" || Number.isNaN(Date.parse(body.dueAt))) {
    return NextResponse.json({ error: "dueAt must be an ISO timestamp" }, { status: 400 });
  }

  try {
    const reminder = await createReminder(scope, {
      enquiryId: typeof body.enquiryId === "string" ? body.enquiryId : null,
      userId: session.userId,
      dueAt: body.dueAt,
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
    });
    return NextResponse.json({ reminder }, { status: 201 });
  } catch (err) {
    // createReminder rejects a past dueAt: that is a bad request, not a bug.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "could not create reminder" },
      { status: 400 },
    );
  }
}
