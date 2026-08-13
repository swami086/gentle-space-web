import { getCampaignById } from "../db/campaigns";
import { listActivities } from "../db/enquiry-activities";
import { getEnquiryById } from "../db/enquiries";
import { getProposalById } from "../db/proposals";
import { scopeClause, type Scope } from "../db/scope-sql";
import { withTenantTransaction } from "../db/tx";

export type GenerativeGroundingPack = {
  entity: "enquiry" | "proposal" | "campaign" | "space";
  id: string;
  builtAt: string;
  rowIds: string[];
  facts: Record<string, unknown>;
};

function notFound(): never {
  throw new Error("entity_not_found");
}

function uniqueRowIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function loadProposalPack(
  scope: Scope,
  id: string,
): Promise<{ facts: Record<string, unknown>; rowIds: string[] }> {
  const proposal = await getProposalById(scope, id);
  if (!proposal) notFound();

  const rowIds = [proposal.id];
  const facts: Record<string, unknown> = { proposal };

  if (proposal.campaignId) {
    rowIds.push(proposal.campaignId);
    const campaign = await getCampaignById(scope, proposal.campaignId);
    if (campaign) facts.campaign = campaign;
  }

  return { facts, rowIds: uniqueRowIds(rowIds) };
}

async function loadEnquiryPack(
  scope: Scope,
  id: string,
): Promise<{ facts: Record<string, unknown>; rowIds: string[] }> {
  const enquiry = await getEnquiryById(scope, id);
  if (!enquiry) notFound();

  const activity = await listActivities(scope, id, 50);
  const rowIds = [
    enquiry.id,
    ...activity.map((a) => a.id),
    ...(enquiry.listingId ? [enquiry.listingId] : []),
    ...(enquiry.corridorId ? [enquiry.corridorId] : []),
  ];

  return {
    facts: { enquiry, activity },
    rowIds: uniqueRowIds(rowIds),
  };
}

async function loadCampaignPack(
  scope: Scope,
  id: string,
): Promise<{ facts: Record<string, unknown>; rowIds: string[] }> {
  const campaign = await getCampaignById(scope, id);
  if (!campaign) notFound();
  return { facts: { campaign }, rowIds: [campaign.id] };
}

type SpaceRow = {
  id: string;
  title: string;
  amenities: unknown;
  synced_at: Date;
  corridor_id: string | null;
};

async function loadSpacePack(
  scope: Scope,
  id: string,
): Promise<{ facts: Record<string, unknown>; rowIds: string[] }> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<SpaceRow>(
      `SELECT l.id,
              l.title,
              l.amenities,
              l.synced_at,
              lc.corridor_id
         FROM listings.listings l
         LEFT JOIN (
           SELECT DISTINCT ON (listing_id) listing_id, corridor_id
             FROM listings.listing_corridors
            ORDER BY listing_id, confidence DESC
         ) lc ON lc.listing_id = l.id
        WHERE l.id = $2
          AND (
            EXISTS (
              SELECT 1
                FROM adsagent.enquiries e
               WHERE e.org_id = $1::uuid
                 AND e.lifecycle = 'active'
                 AND e.listing_id = l.id
            )
            OR EXISTS (
              SELECT 1
                FROM adsagent.campaigns c
                JOIN listings.listing_corridors lcc
                  ON lcc.corridor_id = c.corridor_id
               WHERE c.org_id = $1::uuid
                 AND c.corridor_id IS NOT NULL
                 AND lcc.listing_id = l.id
            )
          )`,
      [...s.params, id],
    );
    if (!rows[0]) notFound();

    const space = rows[0];
    const rowIds = [space.id, ...(space.corridor_id ? [space.corridor_id] : [])];
    return {
      facts: {
        space: {
          id: space.id,
          name: space.title,
          corridor_id: space.corridor_id,
          amenities: space.amenities,
          updated_at: space.synced_at.toISOString(),
        },
      },
      rowIds: uniqueRowIds(rowIds),
    };
  });
}

/** Builds the citation allowlist for a generative surface subject under session Scope. */
export async function buildGroundingPack(
  scope: Scope,
  entity: GenerativeGroundingPack["entity"],
  id: string,
): Promise<GenerativeGroundingPack> {
  const loaded =
    entity === "proposal"
      ? await loadProposalPack(scope, id)
      : entity === "enquiry"
        ? await loadEnquiryPack(scope, id)
        : entity === "campaign"
          ? await loadCampaignPack(scope, id)
          : await loadSpacePack(scope, id);

  return {
    entity,
    id,
    builtAt: new Date().toISOString(),
    facts: loaded.facts,
    rowIds: loaded.rowIds,
  };
}
