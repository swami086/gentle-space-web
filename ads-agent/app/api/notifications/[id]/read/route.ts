import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { markNotificationRead } from "@/lib/db/notifications";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("viewer");
  if (!access.ok) return access.response;
  const { scope, session } = access;
  const { id } = await params;

  const notification = await markNotificationRead(scope, id, session.userId);
  if (!notification) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ notification });
}
