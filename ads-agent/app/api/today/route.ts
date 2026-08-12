import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getTodayFeed } from "@/lib/db/today-feed";

export async function GET(req: Request) {
  const access = await guard("viewer");
  if (!access.ok) return access.response;
  const { scope, session } = access;

  const raw = new URL(req.url).searchParams.get("noContactDays");
  const parsed = raw === null ? 7 : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
    return NextResponse.json(
      { error: "noContactDays must be a whole number between 1 and 365" },
      { status: 400 },
    );
  }

  const feed = await getTodayFeed(scope, {
    userId: session.userId,
    noContactDays: parsed,
  });
  return NextResponse.json(feed);
}
