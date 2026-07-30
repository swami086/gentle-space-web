import { extractSearchEntitiesBatch, isAiSearchConfigured } from "@/lib/ai/client";
import { listListings } from "@/lib/db/listings";
import { buildListingEmbeddingText } from "@/lib/listings/embedding-text";
import { forEachChunkPaced } from "../sync/pace";
import { normalizeQueryEntities } from "./normalize";
import {
  isAgeAvailable,
  replaceListingGraph,
  type ListingInput,
  upsertListingGraph,
  wipeGentleSpaceGraph,
} from "./age";
import { emptyQueryEntities, type QueryEntities } from "./types";
import type { Listing } from "@/lib/listings/types";

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

// Gemini call count is what costs money and burns per-minute quota, not listing
// count — batching N listings per call turns e.g. 340 calls into ~17.
const EXTRACT_BATCH_SIZE = 20;
// Fresh GCP projects default to very low per-minute Gemini/Vertex quotas.
// Pacing to ~30 listings/min keeps large backfills under that ceiling without
// requiring a quota increase, while adding no delay to small incremental runs.
const ITEMS_PER_MINUTE = 30;

async function prepareListingGraphInputs(listings: Listing[]): Promise<ListingInput[]> {
  const prepared: ListingInput[] = [];

  await forEachChunkPaced(listings, EXTRACT_BATCH_SIZE, ITEMS_PER_MINUTE, async (chunk) => {
    const extracted = await extractSearchEntitiesBatch(chunk.map(buildListingEmbeddingText));

    chunk.forEach((listing, j) => {
      prepared.push({
        id: listing.id,
        slug: listing.slug,
        title: listing.title,
        entities: normalizeQueryEntities(mergeEntities(seedListingEntities(listing), extracted[j])),
      });
    });
  });

  return prepared;
}

export async function rebuildListingGraph(): Promise<{ listings: number; skipped: boolean }> {
  if (!isAiSearchConfigured() || !(await isAgeAvailable())) {
    console.info("graph rebuild skipped");
    return { listings: 0, skipped: true };
  }

  const listings = await listListings();
  const preparedListings = await prepareListingGraphInputs(listings);

  await wipeGentleSpaceGraph();

  for (const listing of preparedListings) {
    await upsertListingGraph(listing);
  }

  return { listings: listings.length, skipped: false };
}

export async function syncListingGraph(
  changed: Listing[],
): Promise<{ listings: number; skipped: boolean }> {
  if (!isAiSearchConfigured() || !(await isAgeAvailable())) {
    console.info("graph sync skipped");
    return { listings: 0, skipped: true };
  }

  const preparedListings = await prepareListingGraphInputs(changed);

  for (const listing of preparedListings) {
    await replaceListingGraph(listing);
  }

  // ponytail: soft-hidden Listing nodes remain until graph:rebuild; vector search
  // filters them before graph scoring, and retaining them makes reactivation safe.
  return { listings: preparedListings.length, skipped: false };
}
