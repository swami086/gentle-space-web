import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { updateCampaignStatus } from "@/lib/db/campaigns";
import type { CampaignStatus } from "@/lib/types";

const VALID_STATUSES: CampaignStatus[] = ["proposed", "active", "paused", "removed"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;

  const { id } = await params;
  const { status } = (await req.json()) as { status?: string };
  if (!status || !VALID_STATUSES.includes(status as CampaignStatus)) {
    return NextResponse.json({ error: "status must be one of proposed, active, paused, removed" }, { status: 400 });
  }

  await updateCampaignStatus(id, status as CampaignStatus);
  return NextResponse.json({ ok: true });
}
