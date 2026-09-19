import { NextResponse } from "next/server";
import { isAiSearchConfigured } from "@/lib/ai/client";
import { maxPossibleOverlap } from "../../../../lib/graph/score";
import { toPublicListing } from "../../../../lib/listings/public";
import { emitSearchPerformed } from "../../../../lib/portal/emit";
import { newSessionId, readSessionId, sessionCookie } from "../../../../lib/portal/session";
import { getPostHogClient, readPostHogRequestContext } from "../../../../lib/posthog-server";
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

  const existingSession = readSessionId(req.headers.get("cookie"));
  const sessionId = existingSession ?? newSessionId();
  const requestContext = readPostHogRequestContext(req);
  const posthog = getPostHogClient();

  try {
    const { interpretedQuery, queryEntities, listings } = await retrieveListings(query);
    const matchedEntities = maxPossibleOverlap(queryEntities) > 0 ? queryEntities : undefined;

    await emitSearchPerformed({
      sessionId,
      query,
      filters: { interpreted_query: interpretedQuery.slice(0, 200) },
      resultCount: listings.length,
    });

    if (posthog) {
      posthog.capture({
        distinctId: requestContext.distinctId ?? sessionId,
        event: "space_search_completed",
        properties: {
          result_count: listings.length,
          has_matched_entities: Boolean(matchedEntities),
          matched_entity_count: Object.values(queryEntities).reduce(
            (count, values) => count + values.length,
            0,
          ),
          ...(requestContext.sessionId ? { $session_id: requestContext.sessionId } : {}),
        },
      });
      await posthog.flush();
    }

    const res = NextResponse.json({
      interpretedQuery,
      listings: listings.map(toPublicListing),
      matchedEntities,
    });
    if (!existingSession) res.headers.set("Set-Cookie", sessionCookie(sessionId));
    return res;
  } catch (err) {
    console.error(err);
    if (posthog) {
      posthog.captureException(err, requestContext.distinctId ?? sessionId);
      await posthog.flush();
    }
    return NextResponse.json({ error: "search failed" }, { status: 502 });
  }
}
