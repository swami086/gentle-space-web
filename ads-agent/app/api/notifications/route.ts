import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { countUnread, listNotifications } from "@/lib/db/notifications";

export async function GET(req: Request) {
  const access = await guard("viewer");
  if (!access.ok) return access.response;
  const { scope, session } = access;

  const unreadOnly = new URL(req.url).searchParams.get("unread") === "1";
  const [notifications, unread] = await Promise.all([
    listNotifications(scope, session.userId, { unreadOnly }),
    countUnread(scope, session.userId),
  ]);
  return NextResponse.json({ notifications, unread });
}
