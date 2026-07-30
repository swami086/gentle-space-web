import { NextResponse } from "next/server";
import { isAiSearchConfigured } from "@/lib/ai/client";
import { getListingById } from "@/lib/db/listings";
import { buildInsight } from "@/lib/spaces/insight";
import type { QueryEntities } from "@/lib/graph/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  if (!isAiSearchConfigured()) {
    return NextResponse.json({ error: "insight unavailable" }, { status: 503 });
  }

  let body: { listingId?: string; query?: string; entities?: QueryEntities };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const listingId = body.listingId?.trim() ?? "";
  const query = body.query?.trim() ?? "";
  if (!UUID_RE.test(listingId) || !query || query.length > 500) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  try {
    const listing = await getListingById(listingId);
    if (!listing) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const insight = await buildInsight({ listing, query, entities: body.entities });
    if (!insight.summary && insight.highlights.length === 0) {
      return NextResponse.json({ error: "insight failed" }, { status: 502 });
    }

    return NextResponse.json(insight);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "insight failed" }, { status: 502 });
  }
}
