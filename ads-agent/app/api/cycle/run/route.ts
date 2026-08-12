import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeForSession } from "@/lib/auth/scope-interim";
import { runDecisionCycle } from "@/lib/decision-engine/cycle";
import { touchLastRunAt } from "@/lib/db/org-settings";

export async function POST() {
  const access = await requireApiRole("admin");
  if (!access.ok) return access.response;
  // A cycle runs for exactly one org: the caller's. Platform scope must not
  // widen it, so the job scope is always org-bounded.
  const sessionScope = await scopeForSession(access.session);
  const scope = { kind: "org" as const, orgId: sessionScope.orgId };
  const result = await runDecisionCycle(scope);
  await touchLastRunAt(scope);
  return NextResponse.json(result);
}
