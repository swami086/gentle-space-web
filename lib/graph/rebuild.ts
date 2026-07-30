import { extractSearchEntities, isAiSearchConfigured } from "@/lib/ai/client";
import { listListings } from "@/lib/db/listings";
import { buildListingEmbeddingText } from "@/lib/listings/embedding-text";
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

async function prepareListingGraphInput(listing: Listing): Promise<ListingInput> {
  const extracted = await extractSearchEntities(buildListingEmbeddingText(listing));
  const entities = normalizeQueryEntities(mergeEntities(seedListingEntities(listing), extracted));

  return {
    id: listing.id,
    slug: listing.slug,
    title: listing.title,
    entities,
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
    preparedListings.push(await prepareListingGraphInput(listing));
  }

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

  const preparedListings = [];
  for (const listing of changed) {
    preparedListings.push(await prepareListingGraphInput(listing));
  }

  for (const listing of preparedListings) {
    await replaceListingGraph(listing);
  }

  // ponytail: soft-hidden Listing nodes remain until graph:rebuild; vector search
  // filters them before graph scoring, and retaining them makes reactivation safe.
  return { listings: preparedListings.length, skipped: false };
}
