import { NextResponse } from "next/server";
import { isAiSearchConfigured } from "@/lib/ai/client";
import { maxPossibleOverlap } from "../../../../lib/graph/score";
import { toPublicListing } from "../../../../lib/listings/public";
import { emitSearchPerformed } from "../../../../lib/portal/emit";
import { newSessionId, readSessionId, sessionCookie } from "../../../../lib/portal/session";
import { retrieveListings } from "../../../../lib/search/retrieve";

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

    const existingSession = readSessionId(req.headers.get("cookie"));
    const sessionId = existingSession ?? newSessionId();
    await emitSearchPerformed({
      sessionId,
      query,
      filters: { interpreted_query: interpretedQuery.slice(0, 200) },
      resultCount: listings.length,
    });

    const res = NextResponse.json({
      interpretedQuery,
      listings: listings.map(toPublicListing),
      matchedEntities,
    });
    if (!existingSession) res.headers.set("Set-Cookie", sessionCookie(sessionId));
    return res;
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "search failed" }, { status: 502 });
  }
}
