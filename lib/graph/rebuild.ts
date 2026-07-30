import { extractSearchEntitiesBatchStrict, isAiSearchConfigured } from "@/lib/ai/client";
import { listListings } from "@/lib/db/listings";
import { buildListingEmbeddingText } from "@/lib/listings/embedding-text";
import { forEachChunkPaced } from "../sync/pace";
import { normalizeQueryEntities } from "./normalize";
import {
  isAgeAvailable,
  replaceListingGraphs,
  type ListingInput,
  upsertListingGraphs,
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

// Gemini call count (and cost) scales with batches, not listings — 50/call turns
// a 704-listing rebuild into ~14 generateContent requests instead of 704.
const EXTRACT_BATCH_SIZE = 50;
// ~0.5 requests/min at batch=50 (one call every ~2 min). Fresh projects often
// only get single-digit Gemini RPM; the prior 20/batch @ 30 listings/min still
// 429'd mid-rebuild after an embedding backfill had already heated the project.
const ITEMS_PER_MINUTE = 25;

async function prepareListingGraphInputs(listings: Listing[]): Promise<ListingInput[]> {
  const prepared: ListingInput[] = [];
  let useLlm = true;

  await forEachChunkPaced(listings, EXTRACT_BATCH_SIZE, ITEMS_PER_MINUTE, async (chunk) => {
    let extracted: QueryEntities[];
    if (!useLlm) {
      extracted = chunk.map(() => emptyQueryEntities());
    } else {
      try {
        extracted = await extractSearchEntitiesBatchStrict(chunk.map(buildListingEmbeddingText));
      } catch (error) {
        console.error(
          "extract batch failed; finishing graph prepare with seeded entities only",
          error,
        );
        useLlm = false;
        extracted = chunk.map(() => emptyQueryEntities());
      }
    }

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

  const preparedListings = await prepareListingGraphInputs(changed);
  await replaceListingGraphs(preparedListings);

  // ponytail: soft-hidden Listing nodes remain until graph:rebuild; vector search
  // filters them before graph scoring, and retaining them makes reactivation safe.
  return { listings: preparedListings.length, skipped: false };
}
