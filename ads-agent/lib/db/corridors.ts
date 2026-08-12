import { getPool } from "./client";
import { scopeClause, type Scope } from "./scope-sql";

export type Corridor = {
  id: string;
  slug: string;
  displayName: string;
  city: string;
  parentId: string | null;
};

type CorridorSqlRow = {
  id: string;
  slug: string;
  display_name: string;
  city: string;
  parent_id: string | null;
};

/** `scope` is required by the data-layer contract but applies no clause here:
 *  public.corridors is shared reference data, deliberately not org-scoped and therefore not
 *  RLS-protected (data model §4). The omission is deliberate, not missed. */
export async function listCorridors(scope: Scope): Promise<Corridor[]> {
  void scope;
  const { rows } = await getPool().query<CorridorSqlRow>(
    `SELECT id, slug, display_name, city, parent_id
       FROM public.corridors
      ORDER BY display_name ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    displayName: r.display_name,
    city: r.city,
    parentId: r.parent_id,
  }));
}

export async function corridorListingIds(scope: Scope, corridorId: string): Promise<string[]> {
  const s = scopeClause(scope, "l.org_id");
  const { rows } = await getPool().query<{ listing_id: string }>(
    `SELECT lc.listing_id
       FROM listings.listing_corridors lc
       JOIN listings.listings l ON l.id = lc.listing_id
      WHERE ${s.sql}
        AND lc.corridor_id = $${s.params.length + 1}
      ORDER BY lc.listing_id ASC`,
    [...s.params, corridorId],
  );
  return rows.map((r) => r.listing_id);
}

/** Resolves `listing_url` to `listing_id`, and the listing's highest-confidence corridor to
 *  `corridor_id`. Returns the number of enquiries resolved. Batched so a large backlog does
 *  not hold one long transaction. */
export async function resolveEnquiryListings(scope: Scope, limit: number): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`limit must be a positive integer, got ${limit}`);
  const s = scopeClause(scope, "org_id");
  const result = await getPool().query(
    `WITH candidate AS (
        SELECT id, listing_url
          FROM adsagent.enquiries
         WHERE ${s.sql}
           AND listing_id IS NULL
           AND lifecycle = 'active'
           AND listing_url LIKE '%/spaces/%'
         ORDER BY first_seen_at ASC
         LIMIT $${s.params.length + 1}
     ),
     matched AS (
        SELECT c.id AS enquiry_id, l.id AS listing_id
          FROM candidate c
          JOIN listings.listings l
            ON l.slug = split_part(
                          split_part(
                            split_part(c.listing_url, '/spaces/', 2), '?', 1
                          ), '#', 1
                        )
     )
     UPDATE adsagent.enquiries e
        SET listing_id  = m.listing_id,
            corridor_id = (
              SELECT lc.corridor_id
                FROM listings.listing_corridors lc
               WHERE lc.listing_id = m.listing_id
               ORDER BY lc.confidence DESC, lc.corridor_id ASC
               LIMIT 1
            ),
            updated_at  = now()
       FROM matched m
      WHERE e.id = m.enquiry_id`,
    [...s.params, limit],
  );
  return result.rowCount ?? 0;
}

export async function countUnresolvedEnquiries(scope: Scope): Promise<number> {
  const s = scopeClause(scope, "org_id");
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT COUNT(*) AS count
       FROM adsagent.enquiries
      WHERE ${s.sql}
        AND listing_id IS NULL
        AND lifecycle = 'active'`,
    s.params,
  );
  return Number(rows[0].count);
}
