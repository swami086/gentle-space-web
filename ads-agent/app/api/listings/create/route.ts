import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { scheduleListingCreate, type ListingMarket, type ListingSector } from "@/lib/listings/schedule-create";

function marketOf(value: unknown): ListingMarket | null {
  return value === "IN" || value === "AU" ? value : null;
}

function sectorOf(value: unknown): ListingSector | null {
  return value === "residential" || value === "commercial_office" ? value : null;
}

export async function POST(req: Request) {
  const access = await guard("operator");
  if (!access.ok) return access.response;

  const body = (await req.json()) as {
    market?: unknown;
    sector?: unknown;
    approverPhone?: unknown;
    goal?: unknown;
    dailyMajor?: unknown;
  };
  const market = marketOf(body.market);
  const sector = sectorOf(body.sector);
  const approverPhone = typeof body.approverPhone === "string" ? body.approverPhone.trim() : "";
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  const dailyMajor = body.dailyMajor;
  if (!market || !sector || !approverPhone || !goal) {
    return NextResponse.json({ error: "market, sector, phone, and goal are required" }, { status: 400 });
  }
  if (typeof dailyMajor !== "number" || !Number.isInteger(dailyMajor) || dailyMajor <= 0) {
    return NextResponse.json({ error: "daily spend limit must be a positive whole number" }, { status: 400 });
  }

  const created = await scheduleListingCreate(access.scope, access.session.userId, {
    market,
    sector,
    approverPhone,
    goal,
    dailyMinor: dailyMajor * 100,
  });
  return NextResponse.json(created);
}
