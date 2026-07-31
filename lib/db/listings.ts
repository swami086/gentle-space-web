import type { Listing, ListingSource } from "@/lib/listings/types";
import { parseExtractedEntities } from "../graph/extract";
import type { QueryEntities } from "../graph/types";
import type { EnrichCandidate } from "../sync/enrich-weak";
import { dedupeListings } from "../listings/dedupe";
import type { ExistingListingSyncState } from "../sync/plan";
import { getListingMissingRunsLimit } from "../sync/config";
import { getPool } from "./client";

export type ScoredListing = {
  listing: Listing;
  vectorSimilarity: number;
};

export type PreparedListing = {
  listing: Listing;
  contentHash: string;
  embedHash: string;
  isNew: boolean;
  previousContentHash: string | null;
  previousEmbedHash: string | null;
  wasHidden: boolean;
};

export type SourceWriteResult = {
  inserted: number;
  updated: number;
  unchanged: number;
  graphListings: Listing[];
  newlyHiddenIds: string[];
};

type ListingRow = {
  id: string;
  source: ListingSource;
  source_id: string;
  slug: string;
  title: string;
  description: string;
  short_teaser: string;
  address: string;
  area: string;
  city: string;
  lat: number | null;
  lng: number | null;
  amenities: string[];
  images: string[];
  pricing_hint: string | null;
  property_type: string | null;
  source_url: string;
  synced_at: Date;
  missing_runs: number;
};

function rowToListing(row: ListingRow): Listing {
  return {
    id: row.id,
    source: row.source,
    sourceId: row.source_id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    shortTeaser: row.short_teaser,
    address: row.address,
    area: row.area,
    city: row.city,
    lat: row.lat,
    lng: row.lng,
    amenities: row.amenities ?? [],
    images: row.images ?? [],
    pricingHint: row.pricing_hint,
    propertyType: row.property_type,
    sourceUrl: row.source_url,
    syncedAt: row.synced_at.toISOString(),
  };
}

const LISTING_COLUMNS = 18;

export async function listListings(): Promise<Listing[]> {
  if (!process.env.DATABASE_URL) return [];
  const visibleLimit = getListingMissingRunsLimit();

  const { rows } = await getPool().query<ListingRow>(
    "SELECT * FROM listings WHERE missing_runs < $1 ORDER BY title ASC",
    [visibleLimit],
  );

  return rows.map(rowToListing);
}

export async function getListingBySlug(slug: string): Promise<Listing | null> {
  if (!process.env.DATABASE_URL) return null;
  const visibleLimit = getListingMissingRunsLimit();

  const { rows } = await getPool().query<ListingRow>(
    "SELECT * FROM listings WHERE slug = $1 AND missing_runs < $2 LIMIT 1",
    [slug, visibleLimit],
  );

  return rows[0] ? rowToListing(rows[0]) : null;
}

export async function getListingById(id: string): Promise<Listing | null> {
  if (!process.env.DATABASE_URL) return null;
  const visibleLimit = getListingMissingRunsLimit();

  const { rows } = await getPool().query<ListingRow>(
    "SELECT * FROM listings WHERE id = $1 AND missing_runs < $2 LIMIT 1",
    [id, visibleLimit],
  );

  return rows[0] ? rowToListing(rows[0]) : null;
}

export async function getListingsByIds(ids: string[]): Promise<Listing[]> {
  if (!process.env.DATABASE_URL || ids.length === 0) return [];
  const visibleLimit = getListingMissingRunsLimit();

  const { rows } = await getPool().query<ListingRow>(
    `SELECT * FROM listings
     WHERE id::text = ANY($1::text[])
       AND missing_runs < $2`,
    [ids, visibleLimit],
  );

  return rows.map(rowToListing);
}

export async function fullReplaceListings(rows: Listing[]): Promise<void> {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM listings");

    if (rows.length > 0) {
      const values: unknown[] = [];
      const placeholders = rows.map((row, i) => {
        const offset = i * LISTING_COLUMNS;
        values.push(
          row.id,
          row.source,
          row.sourceId,
          row.slug,
          row.title,
          row.description,
          row.shortTeaser,
          row.address,
          row.area,
          row.city,
          row.lat,
          row.lng,
          JSON.stringify(row.amenities),
          JSON.stringify(row.images),
          row.pricingHint,
          row.propertyType,
          row.sourceUrl,
          row.syncedAt,
        );
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}::jsonb, $${offset + 14}::jsonb, $${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18}::timestamptz, $${offset + 18}::timestamptz)`;
      });

      await client.query(
        `INSERT INTO listings (
          id, source, source_id, slug, title, description, short_teaser,
          address, area, city, lat, lng, amenities, images, pricing_hint,
          property_type, source_url, synced_at, last_seen_at
        ) VALUES ${placeholders.join(", ")}`,
        values,
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function searchListingsByEmbedding(
  embedding: number[],
  k = 20,
): Promise<ScoredListing[]> {
  if (!process.env.DATABASE_URL) return [];
  const vectorLiteral = `[${embedding.join(",")}]`;
  const visibleLimit = getListingMissingRunsLimit();
  const { rows } = await getPool().query<ListingRow & { vector_similarity: number }>(
    `SELECT *, GREATEST(
       1 - (structured_embedding <=> $1::vector),
       1 - (description_embedding <=> $1::vector)
     )::float8 AS vector_similarity
     FROM listings
     WHERE (structured_embedding IS NOT NULL OR description_embedding IS NOT NULL)
       AND missing_runs < $2
     ORDER BY vector_similarity DESC
     LIMIT $3`,
    [vectorLiteral, visibleLimit, k * 4],
  );
  const scored = rows.map((row) => ({
    listing: rowToListing(row),
    vectorSimilarity: row.vector_similarity,
  }));
  const scoresById = new Map(scored.map((row) => [row.listing.id, row.vectorSimilarity]));

  return dedupeListings(scored.map((row) => row.listing))
    .slice(0, k)
    .map((listing) => ({
      listing,
      vectorSimilarity: scoresById.get(listing.id) ?? 0,
    }));
}

export async function updateListingEmbeddings(
  id: string,
  embeddings: { structured: number[]; description: number[] },
): Promise<void> {
  const structuredLiteral = `[${embeddings.structured.join(",")}]`;
  const descriptionLiteral = `[${embeddings.description.join(",")}]`;
  await getPool().query(
    `UPDATE listings
     SET structured_embedding = $1::vector, description_embedding = $2::vector
     WHERE id = $3`,
    [structuredLiteral, descriptionLiteral, id],
  );
}

export async function listExistingForSource(
  source: ListingSource,
): Promise<ExistingListingSyncState[]> {
  if (!process.env.DATABASE_URL) return [];

  const { rows } = await getPool().query<{
    source_id: string;
    id: string;
    slug: string;
    synced_at: Date;
    content_hash: string | null;
    embed_hash: string | null;
    missing_runs: number;
  }>(
    `SELECT source_id, id, slug, synced_at, content_hash, embed_hash, missing_runs
     FROM listings
     WHERE source = $1`,
    [source],
  );

  return rows.map((row) => ({
    sourceId: row.source_id,
    id: row.id,
    slug: row.slug,
    syncedAt: row.synced_at,
    contentHash: row.content_hash,
    embedHash: row.embed_hash,
    missingRuns: row.missing_runs,
  }));
}

export async function applySourceSync(input: {
  source: ListingSource;
  discoveredSourceIds: string[];
  scraped: PreparedListing[];
  missingLimit: number;
  trackMissing: boolean;
}): Promise<SourceWriteResult> {
  const client = await getPool().connect();
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const graphListings: Listing[] = [];

  try {
    await client.query("BEGIN");

    for (const row of input.scraped) {
      const changed = row.previousContentHash !== row.contentHash;
      const embeddingChanged = row.previousEmbedHash !== row.embedHash;

      if (row.isNew) inserted += 1;
      else if (changed) updated += 1;
      else unchanged += 1;

      const values = [
        row.listing.id,
        row.listing.source,
        row.listing.sourceId,
        row.listing.slug,
        row.listing.title,
        row.listing.description,
        row.listing.shortTeaser,
        row.listing.address,
        row.listing.area,
        row.listing.city,
        row.listing.lat,
        row.listing.lng,
        JSON.stringify(row.listing.amenities),
        JSON.stringify(row.listing.images),
        row.listing.pricingHint,
        row.listing.propertyType,
        row.listing.sourceUrl,
        row.listing.syncedAt,
        row.contentHash,
        row.embedHash,
      ];

      const { rows } = await client.query<{ id: string; slug: string }>(
        `INSERT INTO listings (
           id, source, source_id, slug, title, description, short_teaser, address,
           area, city, lat, lng, amenities, images, pricing_hint, property_type,
           source_url, synced_at, last_seen_at, content_hash, embed_hash
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb,
           $14::jsonb, $15, $16, $17, $18::timestamptz, NOW(), $19, $20
         )
         ON CONFLICT (source, source_id) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           short_teaser = EXCLUDED.short_teaser,
           address = EXCLUDED.address,
           area = EXCLUDED.area,
           city = EXCLUDED.city,
           -- Prefer scraped coords; otherwise keep the geocoded ones, but drop them when
           -- the address or area moved so the geocode pass re-derives from the new location.
           lat = CASE
             WHEN EXCLUDED.lat IS NOT NULL THEN EXCLUDED.lat
             WHEN listings.address IS DISTINCT FROM EXCLUDED.address
               OR listings.area IS DISTINCT FROM EXCLUDED.area
               THEN NULL ELSE listings.lat
           END,
           lng = CASE
             WHEN EXCLUDED.lng IS NOT NULL THEN EXCLUDED.lng
             WHEN listings.address IS DISTINCT FROM EXCLUDED.address
               OR listings.area IS DISTINCT FROM EXCLUDED.area
               THEN NULL ELSE listings.lng
           END,
           amenities = EXCLUDED.amenities,
           images = EXCLUDED.images,
           pricing_hint = EXCLUDED.pricing_hint,
           property_type = EXCLUDED.property_type,
           source_url = EXCLUDED.source_url,
           synced_at = EXCLUDED.synced_at,
           last_seen_at = NOW(),
           missing_runs = 0,
           content_hash = EXCLUDED.content_hash,
           embed_hash = EXCLUDED.embed_hash,
           structured_embedding = CASE
             WHEN listings.embed_hash IS DISTINCT FROM EXCLUDED.embed_hash
               THEN NULL ELSE listings.structured_embedding
           END,
           description_embedding = CASE
             WHEN listings.embed_hash IS DISTINCT FROM EXCLUDED.embed_hash
               THEN NULL ELSE listings.description_embedding
           END
         RETURNING id, slug`,
        values,
      );

      row.listing.id = rows[0].id;
      row.listing.slug = rows[0].slug;

      if (row.isNew || embeddingChanged || row.wasHidden) {
        graphListings.push(row.listing);
      }
    }

    await client.query(
      `UPDATE listings
       SET last_seen_at = NOW(), missing_runs = 0
       WHERE source = $1 AND source_id = ANY($2::text[])`,
      [input.source, input.discoveredSourceIds],
    );

    let newlyHiddenIds: string[] = [];

    if (input.trackMissing) {
      const hidden = await client.query<{ id: string; missing_runs: number }>(
        `UPDATE listings
         SET missing_runs = LEAST(missing_runs + 1, $3)
         WHERE source = $1
           AND NOT (source_id = ANY($2::text[]))
           AND missing_runs < $3
         RETURNING id, missing_runs`,
        [input.source, input.discoveredSourceIds, input.missingLimit],
      );

      newlyHiddenIds = hidden.rows
        .filter((row) => row.missing_runs === input.missingLimit)
        .map((row) => row.id);
    }

    await client.query("COMMIT");
    return { inserted, updated, unchanged, graphListings, newlyHiddenIds };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listListingsMissingEmbedding(): Promise<Listing[]> {
  if (!process.env.DATABASE_URL) return [];

  const { rows } = await getPool().query<ListingRow>(
    `SELECT * FROM listings
     WHERE (structured_embedding IS NULL OR description_embedding IS NULL) AND missing_runs < $1
     ORDER BY title ASC`,
    [getListingMissingRunsLimit()],
  );

  return rows.map(rowToListing);
}

export async function listEnrichmentCandidates(): Promise<EnrichCandidate[]> {
  if (!process.env.DATABASE_URL) return [];

  const { rows } = await getPool().query<{
    id: string;
    title: string;
    source_url: string;
    area: string | null;
    address: string | null;
    pricing_hint: string | null;
    lat: number | null;
    lng: number | null;
    synced_at: Date;
  }>(
    `SELECT id, title, source_url, area, address, pricing_hint, lat, lng, synced_at
     FROM listings
     WHERE missing_runs < $1
     ORDER BY synced_at DESC`,
    [getListingMissingRunsLimit()],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    sourceUrl: row.source_url,
    area: row.area ?? "",
    address: row.address ?? "",
    pricingHint: row.pricing_hint,
    lat: row.lat,
    lng: row.lng,
    syncedAt: row.synced_at.toISOString(),
  }));
}

export async function listRecentlyAcceptedEnrichmentIds(
  cooldownDays: number,
): Promise<Map<string, string>> {
  if (!process.env.DATABASE_URL) return new Map();

  const { rows } = await getPool().query<{ listing_id: string; created_at: Date }>(
    `SELECT DISTINCT ON (listing_id) listing_id, created_at
     FROM public.listing_enrichment_log
     WHERE accepted = true
       AND created_at >= now() - ($1 * interval '1 day')
     ORDER BY listing_id, created_at DESC`,
    [cooldownDays],
  );

  return new Map(rows.map((row) => [row.listing_id, row.created_at.toISOString()]));
}

export async function applyListingEnrichment(
  id: string,
  patch: {
    area?: string;
    address?: string;
    pricingHint?: string;
    locationChanged: boolean;
    priceChanged: boolean;
  },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.area !== undefined) {
    values.push(patch.area);
    sets.push(`area = $${values.length}`);
  }

  if (patch.address !== undefined) {
    values.push(patch.address);
    sets.push(`address = $${values.length}`);
  }

  if (patch.pricingHint !== undefined) {
    values.push(patch.pricingHint);
    sets.push(`pricing_hint = $${values.length}`);
  }

  if (patch.locationChanged) {
    sets.push("lat = NULL", "lng = NULL", "structured_embedding = NULL", "embed_hash = NULL");
  } else if (patch.priceChanged) {
    sets.push("structured_embedding = NULL", "embed_hash = NULL");
  }

  if (sets.length === 0) return;

  values.push(id);
  await getPool().query(
    `UPDATE listings
     SET ${sets.join(", ")}
     WHERE id = $${values.length}`,
    values,
  );
}

export async function insertEnrichmentLog(row: {
  listingId: string;
  pass: "page" | "web";
  accepted: boolean;
  payload: unknown;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO public.listing_enrichment_log (listing_id, pass, accepted, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [row.listingId, row.pass, row.accepted, JSON.stringify(row.payload ?? {})],
  );
}

export async function countVisibleListings(): Promise<number> {
  if (!process.env.DATABASE_URL) return 0;

  const { rows } = await getPool().query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM listings WHERE missing_runs < $1",
    [getListingMissingRunsLimit()],
  );

  return Number(rows[0]?.count ?? 0);
}

export async function listListingEntityHashes(): Promise<Map<string, string | null>> {
  if (!process.env.DATABASE_URL) return new Map();

  const { rows } = await getPool().query<{ id: string; entities_hash: string | null }>(
    `SELECT id, entities_hash
     FROM listings
     WHERE missing_runs < $1`,
    [getListingMissingRunsLimit()],
  );

  return new Map(rows.map((row) => [row.id, row.entities_hash]));
}

export async function updateListingExtractedEntities(
  id: string,
  entities: QueryEntities,
  entitiesHash: string,
): Promise<void> {
  await getPool().query(
    `UPDATE listings
     SET extracted_entities = $1::jsonb, entities_hash = $2
     WHERE id = $3`,
    [JSON.stringify(entities), entitiesHash, id],
  );
}

export async function listListingExtractedEntities(): Promise<Map<string, QueryEntities>> {
  if (!process.env.DATABASE_URL) return new Map();

  const { rows } = await getPool().query<{ id: string; extracted_entities: unknown }>(
    `SELECT id, extracted_entities
     FROM listings
     WHERE missing_runs < $1
       AND extracted_entities IS NOT NULL`,
    [getListingMissingRunsLimit()],
  );

  return new Map(
    rows
      .filter((row) => row.extracted_entities !== null)
      .map((row) => [row.id, parseExtractedEntities(row.extracted_entities)]),
  );
}
