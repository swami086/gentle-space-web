import { createHash } from "node:crypto";
import { buildListingEmbeddingText } from "../listings/embedding-text";
import type { RawListing } from "./sources/types";

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

export function hashEmbeddingTextValue(value: string): string {
  return sha256(value);
}

export function contentHash(row: RawListing): string {
  return sha256({
    source: row.source,
    sourceId: row.sourceId,
    title: row.title.trim(),
    description: row.description.trim(),
    shortTeaser: row.shortTeaser.trim(),
    address: row.address.trim(),
    area: row.area.trim(),
    city: row.city.trim(),
    lat: row.lat,
    lng: row.lng,
    amenities: sortedUnique(row.amenities),
    images: row.images,
    pricingHint: row.pricingHint?.trim() ?? null,
    propertyType: row.propertyType?.trim() ?? null,
    sourceUrl: row.sourceUrl,
  });
}

export function hashEmbeddingText(
  fields: Parameters<typeof buildListingEmbeddingText>[0],
): string {
  return hashEmbeddingTextValue(
    buildListingEmbeddingText({
      ...fields,
      amenities: sortedUnique(fields.amenities),
    }),
  );
}

export function embedHash(row: RawListing): string {
  return hashEmbeddingText(row);
}
