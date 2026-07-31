import { NextResponse } from "next/server";
import { isAiSearchConfigured } from "@/lib/ai/client";
import { maxPossibleOverlap } from "../../../../lib/graph/score";
import { toPublicListing } from "../../../../lib/listings/public";
import { retrieveListings } from "../../../../lib/search/retrieve";
import { logSearchQuery } from "../../../../lib/search/query-log";

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
    const { interpretedQuery, queryEntities, listings } = await retrieveListings(query);
    const matchedEntities = maxPossibleOverlap(queryEntities) > 0 ? queryEntities : undefined;

    await logSearchQuery({
      query,
      interpretedQuery,
      entities: queryEntities,
      resultCount: listings.length,
    });

    return NextResponse.json({
      interpretedQuery,
      listings: listings.map(toPublicListing),
      matchedEntities,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "search failed" }, { status: 502 });
  }
}
