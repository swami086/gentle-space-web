import assert from "node:assert/strict";
import { listListings } from "../lib/db/listings";
import { emptyQueryEntities } from "../lib/graph/types";
import { isPlacesConfigured } from "../lib/places/client";
import { buildInsight } from "../lib/spaces/insight";

const PREFERRED_AREAS = new Set(["bellandur", "koramangala"]);

function normalizeArea(area: string): string {
  return area.trim().toLowerCase().replace(/\s+/g, " ");
}

function hasSaneArea(area: string): boolean {
  const trimmed = area.trim();
  return (
    trimmed.length >= 3 &&
    trimmed.length <= 40 &&
    !/(?:!\[|\]\(|https?:\/\/|alt=|token=|\.(?:png|jpe?g|webp|svg))/i.test(trimmed) &&
    /^[A-Za-z0-9][A-Za-z0-9\s.'-]*$/.test(trimmed)
  );
}

function pickListingWithCoords(listings: Awaited<ReturnType<typeof listListings>>) {
  const saneListings = listings.filter(
    (candidate) =>
      hasSaneArea(candidate.area) && candidate.lat != null && candidate.lng != null,
  );
  return (
    saneListings.find(
      (candidate) =>
        candidate.source === "coworker" &&
        PREFERRED_AREAS.has(normalizeArea(candidate.area)),
    ) ??
    saneListings.find((candidate) => candidate.source === "coworker") ??
    saneListings.find((candidate) => PREFERRED_AREAS.has(normalizeArea(candidate.area))) ??
    saneListings[0] ??
    null
  );
}

async function main() {
  assert.ok(
    isPlacesConfigured(),
    "GOOGLE_PLACES_API_KEY is not set — add it to .env.local (Places API (New), server-only)",
  );

  const listings = await listListings();
  const listing = pickListingWithCoords(listings);
  assert.ok(
    listing,
    "no listing with sane area and coordinates — run sync:preview or inspect malformed source rows",
  );

  const entities = {
    ...emptyQueryEntities(),
    amenities: ["coffee"],
    landmarks: ["metro"],
  };

  const insight = await buildInsight({
    listing,
    query: "coworking near metro with coffee nearby",
    entities,
  });

  assert.ok(
    insight.highlights.length > 0,
    `expected at least one highlight for ${listing.slug}`,
  );

  const nearbyCount = insight.nearby.reduce(
    (total, group) => total + group.places.length,
    0,
  );
  assert.ok(
    nearbyCount > 0,
    `expected at least one nearby place for ${listing.slug} — verify GOOGLE_PLACES_API_KEY allows Places API (New)`,
  );

  console.log(
    `insight ok: ${listing.slug}; highlights=${insight.highlights.length}, nearby places=${nearbyCount}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
