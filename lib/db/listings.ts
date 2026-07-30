import type { Listing, ListingSource } from "@/lib/listings/types";
import { getPool } from "./client";

export type ScoredListing = {
  listing: Listing;
  vectorSimilarity: number;
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

  const { rows } = await getPool().query<ListingRow>(
    "SELECT * FROM listings ORDER BY title ASC",
  );

  return rows.map(rowToListing);
}

export async function getListingBySlug(slug: string): Promise<Listing | null> {
  if (!process.env.DATABASE_URL) return null;

  const { rows } = await getPool().query<ListingRow>(
    "SELECT * FROM listings WHERE slug = $1 LIMIT 1",
    [slug],
  );

  return rows[0] ? rowToListing(rows[0]) : null;
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
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}::jsonb, $${offset + 14}::jsonb, $${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18}::timestamptz)`;
      });

      await client.query(
        `INSERT INTO listings (
          id, source, source_id, slug, title, description, short_teaser,
          address, area, city, lat, lng, amenities, images,
          pricing_hint, property_type, source_url, synced_at
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
  const { rows } = await getPool().query<ListingRow & { vector_similarity: number }>(
    `SELECT *, (1 - (embedding <=> $1::vector))::float8 AS vector_similarity
     FROM listings
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vectorLiteral, k],
  );
  return rows.map((row) => ({
    listing: rowToListing(row),
    vectorSimilarity: row.vector_similarity,
  }));
}

export async function updateListingEmbedding(
  id: string,
  embedding: number[],
): Promise<void> {
  const vectorLiteral = `[${embedding.join(",")}]`;
  await getPool().query(
    `UPDATE listings SET embedding = $1::vector WHERE id = $2`,
    [vectorLiteral, id],
  );
}
