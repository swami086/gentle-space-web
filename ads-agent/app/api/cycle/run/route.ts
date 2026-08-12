import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { runDecisionCycle } from "@/lib/decision-engine/cycle";
import { touchLastRunAt } from "@/lib/db/org-settings";

export async function POST() {
  const access = await guard("admin");
  if (!access.ok) return access.response;
  const scope = { kind: "org" as const, orgId: access.scope.orgId };
  const result = await runDecisionCycle(scope);
  await touchLastRunAt(scope);
  return NextResponse.json(result);
}
