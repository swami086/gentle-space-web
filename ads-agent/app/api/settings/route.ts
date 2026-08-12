import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getOrgSettings, setCronEnabled } from "@/lib/db/org-settings";

export async function GET() {
  const access = await guard("viewer");
  if (!access.ok) return access.response;
  return NextResponse.json(await getOrgSettings(access.scope));
}

export async function PATCH(req: Request) {
  const access = await guard("admin");
  if (!access.ok) return access.response;
  const body = (await req.json()) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  await setCronEnabled(access.scope, body.enabled);
  return NextResponse.json({ ok: true });
}
