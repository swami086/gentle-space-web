import { NextResponse } from "next/server";
import { guard, ownedOr404 } from "@/lib/auth/guard";
import { getCampaignById, updateCampaignStatus } from "@/lib/db/campaigns";
import type { CampaignStatus } from "@/lib/types";

const VALID_STATUSES: CampaignStatus[] = ["proposed", "active", "paused", "removed"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard("operator");
  if (!access.ok) return access.response;
  const { scope } = access;

  const { id } = await params;
  const { status } = (await req.json()) as { status?: string };
  if (!status || !VALID_STATUSES.includes(status as CampaignStatus)) {
    return NextResponse.json({ error: "status must be one of proposed, active, paused, removed" }, { status: 400 });
  }

  const owned = await ownedOr404((s) => getCampaignById(s, id), scope);
  if (!owned.ok) return owned.response;

  await updateCampaignStatus(scope, id, status as CampaignStatus);
  return NextResponse.json({ ok: true });
}
