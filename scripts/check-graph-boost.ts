import assert from "node:assert/strict";
import { listListings } from "../lib/db/listings";
import { scoreListingsAgainstQuery } from "../lib/graph/age";
import { isAgeAvailable } from "../lib/graph/age";
import { emptyQueryEntities } from "../lib/graph/types";

// A listing seeded into the graph with IN_AREA must score against its own area.
// /api/spaces/search swallows graph failures and falls back to vector-only, so
// without this check a broken rank-boost is invisible.
async function main() {
  assert.ok(await isAgeAvailable(), "AGE graph 'gentle_space' unavailable");

  const listings = await listListings();
  const listing = listings.find((candidate) => candidate.area);
  assert.ok(listing, "no listing with an area - run npm run sync:preview && npm run graph:rebuild");

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

  console.log(`graph boost ok: ${listing.slug} scored ${hit.overlap} on area "${listing.area}"`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
