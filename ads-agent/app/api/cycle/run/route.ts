import { NextResponse } from "next/server";
import { runDecisionCycle } from "@/lib/decision-engine/cycle";
import { touchLastRunAt } from "@/lib/db/settings";

export async function POST() {
  const result = await runDecisionCycle();
  await touchLastRunAt();
  return NextResponse.json(result);
}
