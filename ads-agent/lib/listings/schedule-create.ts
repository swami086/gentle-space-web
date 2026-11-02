import { randomUUID } from "node:crypto";

import { getOrgSettings } from "../db/org-settings";
import { buildListingCreateProposal, createProposal, scheduleProposal } from "../db/proposals";
import type { Scope } from "../db/scope-sql";
import { withTenantTransaction } from "../db/tx";
import type { Platform } from "../types";

export type ListingSector = "residential" | "commercial_office";
export type ListingMarket = "IN" | "AU";

export function platformsForSector(sector: ListingSector): Platform[] {
  return sector === "commercial_office" ? ["meta", "google"] : ["meta"];
}

export function splitDailyMinor(totalMinor: number, platforms: Platform[]): { platform: Platform; minor: number }[] {
  const base = Math.floor(totalMinor / platforms.length);
  let remainder = totalMinor - base * platforms.length;
  return platforms.map((platform) => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return { platform, minor: base + extra };
  });
}

export async function scheduleListingCreate(
  scope: Scope,
  decidedBy: string,
  input: {
    market: ListingMarket;
    sector: ListingSector;
    approverPhone: string;
    goal: string;
    dailyMinor: number;
  },
): Promise<{ listingId: string; proposalIds: string[] }> {
  const platforms = platformsForSector(input.sector);
  const parts = splitDailyMinor(input.dailyMinor, platforms);
  const traceId = randomUUID();
  const settings = await getOrgSettings(scope);

  const listingId = await withTenantTransaction(scope, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO adsagent.listings (org_id, approver_phone, market, sector, facts)
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb)
       RETURNING id`,
      [scope.orgId, input.approverPhone, input.market, input.sector, JSON.stringify({ goal: input.goal })],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error("listing insert returned no row");
    return id;
  });

  const proposalIds: string[] = [];
  for (const part of parts) {
    const created = await createProposal(
      scope,
      buildListingCreateProposal({
        traceId,
        triggeredRule: "listing_create",
        rationale: input.goal,
        listingId,
        market: input.market,
        sector: input.sector,
        approverPhone: input.approverPhone,
        goal: input.goal,
        ceilings: [{ platform: part.platform, ceilingMinor: part.minor }],
        shares: [{ platform: part.platform, budgetMinor: part.minor }],
      }),
    );
    const scheduled = await scheduleProposal(scope, created.id, {
      decidedBy,
      decidedVia: "ui",
      undoWindowSeconds: settings.undoWindowSeconds,
    });
    if (!scheduled) throw new Error(`proposal ${created.id} was not scheduled`);
    proposalIds.push(scheduled.id);
  }
  return { listingId, proposalIds };
}
