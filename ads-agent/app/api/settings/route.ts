import { NextResponse } from "next/server";
import { getCronSettings, setCronEnabled } from "@/lib/db/settings";

export async function GET() {
  const settings = await getCronSettings();
  return NextResponse.json(settings);
}

export async function PATCH(req: Request) {
  const body = (await req.json()) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  await setCronEnabled(body.enabled);
  return NextResponse.json({ ok: true });
}
