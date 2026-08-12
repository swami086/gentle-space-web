import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { runDecisionCycle } from "@/lib/decision-engine/cycle";
import { touchLastRunAt } from "@/lib/db/settings";

export async function POST() {
  const access = await requireApiRole("admin");
  if (!access.ok) return access.response;
  const result = await runDecisionCycle();
  await touchLastRunAt();
  return NextResponse.json(result);
}
