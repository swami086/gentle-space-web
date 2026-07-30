import { NextResponse } from "next/server";
import { isAiSearchConfigured } from "@/lib/ai/client";
import { getListingById } from "@/lib/db/listings";
import { emptyQueryEntities, type QueryEntities } from "../../../../lib/graph/types";
import { buildInsight } from "@/lib/spaces/insight";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_FIELDS = [
  "areas",
  "amenities",
  "deskTypes",
  "landmarks",
  "budgetSignals",
] as const;
const MAX_ENTITY_ITEMS = 20;
const MAX_ENTITY_ITEM_CHARS = 100;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_ENTITY_ITEMS) return null;

  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > MAX_ENTITY_ITEM_CHARS) return null;
    items.push(trimmed);
  }
  return items;
}

function parseEntities(value: unknown): QueryEntities | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) return "invalid";

  for (const field of ENTITY_FIELDS) {
    if (!(field in value)) return "invalid";
  }

  const areas = parseStringList(value.areas);
  const amenities = parseStringList(value.amenities);
  const deskTypes = parseStringList(value.deskTypes);
  const landmarks = parseStringList(value.landmarks);
  const budgetSignals = parseStringList(value.budgetSignals);
  if (
    areas === null ||
    amenities === null ||
    deskTypes === null ||
    landmarks === null ||
    budgetSignals === null
  ) {
    return "invalid";
  }

  return { areas, amenities, deskTypes, landmarks, budgetSignals };
}

function parseInsightBody(body: unknown):
  | { ok: true; listingId: string; query: string; entities: QueryEntities }
  | { ok: false } {
  if (!isPlainRecord(body)) return { ok: false };

  if (typeof body.listingId !== "string" || typeof body.query !== "string") {
    return { ok: false };
  }

  const listingId = body.listingId.trim();
  const query = body.query.trim();
  if (!UUID_RE.test(listingId) || !query || query.length > 500) return { ok: false };

  const entities = parseEntities(body.entities);
  if (entities === "invalid") return { ok: false };

  return {
    ok: true,
    listingId,
    query,
    entities: entities ?? emptyQueryEntities(),
  };
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = parseInsightBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  if (!isAiSearchConfigured()) {
    return NextResponse.json({ error: "insight unavailable" }, { status: 503 });
  }

  try {
    const listing = await getListingById(parsed.listingId);
    if (!listing) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const insight = await buildInsight({
      listing,
      query: parsed.query,
      entities: parsed.entities,
    });
    if (!insight.summary && insight.highlights.length === 0) {
      return NextResponse.json({ error: "insight failed" }, { status: 502 });
    }

    return NextResponse.json(insight);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "insight failed" }, { status: 502 });
  }
}
