import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { getCronSettings, setCronEnabled } from "@/lib/db/settings";

export async function GET() {
  const access = await requireApiRole("viewer");
  if (!access.ok) return access.response;
  const settings = await getCronSettings();
  return NextResponse.json(settings);
}

export async function PATCH(req: Request) {
  const access = await requireApiRole("admin");
  if (!access.ok) return access.response;
  const body = (await req.json()) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  await setCronEnabled(body.enabled);
  return NextResponse.json({ ok: true });
}
