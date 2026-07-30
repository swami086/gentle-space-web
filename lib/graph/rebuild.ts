import { extractSearchEntitiesBatchStrict, isAiSearchConfigured } from "@/lib/ai/client";
import {
  listListingExtractedEntities,
  listListings,
  updateListingExtractedEntities,
} from "@/lib/db/listings";
import { buildListingEmbeddingText } from "@/lib/listings/embedding-text";
import { hashEmbeddingText } from "@/lib/sync/content-hash";
import { forEachChunkPaced } from "@/lib/sync/pace";
import { normalizeQueryEntities } from "./normalize";
import {
  isAgeAvailable,
  replaceListingGraphs,
  type ListingInput,
  wipeGentleSpaceGraph,
  upsertListingGraphs,
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

const EXTRACT_BATCH_SIZE = 50;
const ITEMS_PER_MINUTE = 25;

function listingToGraphInput(listing: Listing, extracted: QueryEntities): ListingInput {
  return {
    id: listing.id,
    slug: listing.slug,
    title: listing.title,
    entities: normalizeQueryEntities(mergeEntities(seedListingEntities(listing), extracted)),
  };
}

export async function rebuildListingGraph(): Promise<{ listings: number; skipped: boolean }> {
  if (!process.env.DATABASE_URL || !(await isAgeAvailable())) {
    console.info("graph rebuild skipped");
    return { listings: 0, skipped: true };
  }

  const [listings, extractedByListingId] = await Promise.all([
    listListings(),
    listListingExtractedEntities(),
  ]);
  const preparedListings = listings.map((listing) =>
    listingToGraphInput(listing, extractedByListingId.get(listing.id) ?? emptyQueryEntities()),
  );

  await wipeGentleSpaceGraph();
  await upsertListingGraphs(preparedListings);

  return { listings: listings.length, skipped: false };
}

export async function syncListingGraph(
  changed: Listing[],
): Promise<{ listings: number; skipped: boolean }> {
  if (!isAiSearchConfigured() || !(await isAgeAvailable())) {
    console.info("graph sync skipped");
    return { listings: 0, skipped: true };
  }

  if (changed.length === 0) {
    return { listings: 0, skipped: false };
  }

  const preparedListings: ListingInput[] = [];
  await forEachChunkPaced(changed, EXTRACT_BATCH_SIZE, ITEMS_PER_MINUTE, async (chunk) => {
    const extracted = await extractSearchEntitiesBatchStrict(chunk.map(buildListingEmbeddingText));

    for (const [index, listing] of chunk.entries()) {
      const extractedEntities = extracted[index] ?? emptyQueryEntities();
      await updateListingExtractedEntities(listing.id, extractedEntities, hashEmbeddingText(listing));
      preparedListings.push(listingToGraphInput(listing, extractedEntities));
    }
  });

  await replaceListingGraphs(preparedListings);

  // ponytail: soft-hidden Listing nodes remain until graph:rebuild; vector search
  // filters them before graph scoring, and retaining them makes reactivation safe.
  return { listings: preparedListings.length, skipped: false };
}
