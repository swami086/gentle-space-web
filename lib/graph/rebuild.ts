import { extractSearchEntities, isAiSearchConfigured } from "@/lib/ai/client";
import { listListings } from "@/lib/db/listings";
import { buildListingEmbeddingText } from "@/lib/listings/embedding-text";
import { normalizeQueryEntities } from "./normalize";
import { isAgeAvailable, upsertListingGraph, wipeGentleSpaceGraph } from "./age";
import { emptyQueryEntities, type QueryEntities } from "./types";

function mergeEntities(seed: QueryEntities, extracted: QueryEntities): QueryEntities {
  return {
    areas: [...seed.areas, ...extracted.areas],
    amenities: [...seed.amenities, ...extracted.amenities],
    deskTypes: [...seed.deskTypes, ...extracted.deskTypes],
    landmarks: [...seed.landmarks, ...extracted.landmarks],
    budgetSignals: [...seed.budgetSignals, ...extracted.budgetSignals],
  };
}

function seedListingEntities(listing: Awaited<ReturnType<typeof listListings>>[number]): QueryEntities {
  return {
    ...emptyQueryEntities(),
    areas: [listing.area, listing.city].filter(Boolean),
    amenities: listing.amenities,
    deskTypes: listing.propertyType ? [listing.propertyType] : [],
    landmarks: [],
    budgetSignals: [],
  };
}

export async function rebuildListingGraph(): Promise<{ listings: number; skipped: boolean }> {
  if (!isAiSearchConfigured() || !(await isAgeAvailable())) {
    console.info("graph rebuild skipped");
    return { listings: 0, skipped: true };
  }

  const listings = await listListings();
  const preparedListings = [];

  for (const listing of listings) {
    const extracted = await extractSearchEntities(buildListingEmbeddingText(listing));
    const entities = normalizeQueryEntities(mergeEntities(seedListingEntities(listing), extracted));

    preparedListings.push({
      id: listing.id,
      slug: listing.slug,
      title: listing.title,
      entities,
    });
  }

  await wipeGentleSpaceGraph();

  for (const listing of preparedListings) {
    await upsertListingGraph(listing);
  }

  return { listings: listings.length, skipped: false };
}

export async function syncListingGraph(
  _changed: Awaited<ReturnType<typeof listListings>>,
): Promise<{ listings: number; skipped: boolean }> {
  // ponytail: Task 5 keeps the old full rebuild behind the new hook; Task 6 replaces this with per-listing updates.
  return rebuildListingGraph();
}
