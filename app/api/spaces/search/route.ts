import { NextResponse } from "next/server";
import {
  embedTexts,
  extractSearchEntities,
  isAiSearchConfigured,
  rewriteSearchQuery,
} from "@/lib/ai/client";
import { searchListingsByEmbedding } from "@/lib/db/listings";
import {
  maxPossibleOverlap,
  mergeVectorAndGraphScores,
  graphBoostLambda,
} from "../../../../lib/graph/score";
import { emptyQueryEntities } from "../../../../lib/graph/types";
import { normalizeQueryEntities } from "../../../../lib/graph/normalize";
import { scoreListingsAgainstQuery } from "../../../../lib/graph/age";

export async function POST(req: Request) {
  if (!isAiSearchConfigured()) {
    return NextResponse.json({ error: "search unavailable" }, { status: 503 });
  }
  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const query = body.query?.trim() ?? "";
  if (!query || query.length > 500) {
    return NextResponse.json({ error: "invalid query" }, { status: 400 });
  }
  try {
    const interpretedQuery = await rewriteSearchQuery(query);
    const queryEntities = normalizeQueryEntities(await extractSearchEntities(query));
    const k = Number(process.env.GRAPH_VECTOR_K ?? 20) || 20;
    const [embedding] = await embedTexts([interpretedQuery]);
    const scored = await searchListingsByEmbedding(embedding, k);
    let listings = scored.slice(0, 10).map((s) => s.listing);
    const matchedEntities = maxPossibleOverlap(queryEntities) > 0 ? queryEntities : undefined;

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
        listings = ranked.slice(0, 10).map((candidate) => byId.get(candidate.id)!);
      }
    } catch (err) {
      console.error("graph boost failed; vector-only", err);
    }

    return NextResponse.json({ interpretedQuery, listings, matchedEntities });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "search failed" }, { status: 502 });
  }
}
