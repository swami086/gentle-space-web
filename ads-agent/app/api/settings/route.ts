import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { scopeForSession } from "@/lib/auth/scope-interim";
import { getOrgSettings, setCronEnabled } from "@/lib/db/org-settings";

export async function GET() {
  const access = await requireApiRole("viewer");
  if (!access.ok) return access.response;
  const scope = await scopeForSession(access.session);
  return NextResponse.json(await getOrgSettings(scope));
}

export async function PATCH(req: Request) {
  const access = await requireApiRole("admin");
  if (!access.ok) return access.response;
  const scope = await scopeForSession(access.session);
  const body = (await req.json()) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  await setCronEnabled(scope, body.enabled);
  return NextResponse.json({ ok: true });
}
