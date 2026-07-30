import assert from "node:assert/strict";
import { listListings } from "../lib/db/listings";
import { scoreListingsAgainstQuery } from "../lib/graph/age";
import { isAgeAvailable } from "../lib/graph/age";
import { emptyQueryEntities } from "../lib/graph/types";

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

function pickListingWithArea(listings: Awaited<ReturnType<typeof listListings>>) {
  const saneListings = listings.filter((candidate) => hasSaneArea(candidate.area));
  return (
    saneListings.find(
      (candidate) =>
        candidate.source === "coworker" && PREFERRED_AREAS.has(normalizeArea(candidate.area)),
    ) ??
    saneListings.find((candidate) => candidate.source === "coworker") ??
    saneListings.find((candidate) => PREFERRED_AREAS.has(normalizeArea(candidate.area))) ??
    saneListings[0] ??
    null
  );
}

// A listing seeded into the graph with IN_AREA must score against its own area.
// /api/spaces/search swallows graph failures and falls back to vector-only, so
// without this check a broken rank-boost is invisible.
async function main() {
  assert.ok(await isAgeAvailable(), "AGE graph 'gentle_space' unavailable");

  const listings = await listListings();
  const listing = pickListingWithArea(listings);
  assert.ok(
    listing,
    "no listing with a sane area name - expected a short place like Bellandur or Koramangala; rerun preview sync or inspect malformed source areas",
  );

  const scored = await scoreListingsAgainstQuery([listing.id], {
    ...emptyQueryEntities(),
    areas: [listing.area],
  });

  const hit = scored.get(listing.id);
  assert.ok(hit, `no graph row for ${listing.slug}`);
  assert.ok(
    hit.overlap > 0,
    `expected graph overlap for ${listing.slug} in ${listing.area}, got ${hit.overlap}`,
  );

  console.log(
    `graph boost ok: ${listing.slug} (${listing.source}) scored ${hit.overlap} on area "${listing.area}"`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
