import { embedTexts, extractSearchEntities, rewriteSearchQuery } from "../ai/client";
import { searchListingsByEmbedding } from "../db/listings";
import { scoreListingsAgainstQuery } from "../graph/age";
import { normalizeQueryEntities } from "../graph/normalize";
import { graphBoostLambda, maxPossibleOverlap, mergeVectorAndGraphScores } from "../graph/score";
import { emptyQueryEntities, type QueryEntities } from "../graph/types";
import type { Listing } from "../listings/types";

export type RetrievalResult = {
  interpretedQuery: string;
  queryEntities: QueryEntities;
  listings: Listing[];
};

/**
 * Single retrieval path shared by the search API and the eval harness. Returns
 * unmasked listings; callers facing the browser must map through toPublicListing.
 */
export async function retrieveListings(query: string, limit = 10): Promise<RetrievalResult> {
  const interpretedQuery = await rewriteSearchQuery(query);
  const queryEntities = normalizeQueryEntities(await extractSearchEntities(query));
  const k = Number(process.env.GRAPH_VECTOR_K ?? 20) || 20;
  const [embedding] = await embedTexts([interpretedQuery], "query");
  const scored = await searchListingsByEmbedding(embedding, k);
  let listings = scored.slice(0, limit).map((s) => s.listing);

  try {
    if (maxPossibleOverlap(queryEntities) > 0 && scored.length > 0) {
      const overlapMap = await scoreListingsAgainstQuery(
        scored.map((s) => s.listing.id),
        queryEntities,
      );
      const ranked = mergeVectorAndGraphScores(
        scored.map((s) => {
          const hit = overlapMap.get(s.listing.id);
          return {
            id: s.listing.id,
            vectorSimilarity: s.vectorSimilarity,
            graphOverlap: hit?.overlap ?? 0,
            matchedEntities: hit?.matched ?? emptyQueryEntities(),
          };
        }),
        graphBoostLambda(),
        maxPossibleOverlap(queryEntities),
      );
      const byId = new Map(scored.map((s) => [s.listing.id, s.listing]));
      listings = ranked.slice(0, limit).map((candidate) => byId.get(candidate.id)!);
    }
  } catch (err) {
    console.error("graph boost failed; vector-only", err);
  }

  return { interpretedQuery, queryEntities, listings };
}
