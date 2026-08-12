import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { REMINDER_STATES, setReminderState, type ReminderState } from "@/lib/db/reminders";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope } = access;
  const { id } = await params;

  let state: unknown;
  try {
    ({ state } = (await req.json()) as { state?: unknown });
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  // 'fired' is the scheduler's to set, not a client's.
  const settable: ReminderState[] = ["done", "cancelled"];
  if (typeof state !== "string" || !settable.includes(state as ReminderState)) {
    return NextResponse.json(
      { error: `state must be one of ${settable.join(", ")} (of ${REMINDER_STATES.join(", ")})` },
      { status: 400 },
    );
  }

  const reminder = await setReminderState(scope, id, state as ReminderState);
  if (!reminder) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ reminder });
}
