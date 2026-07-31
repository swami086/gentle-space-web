import { emptyQueryEntities, type QueryEntities } from "./types";
import { normalizeQueryEntities } from "./normalize";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function parseExtractedEntities(raw: unknown): QueryEntities {
  if (!isRecord(raw)) return emptyQueryEntities();

  try {
    return normalizeQueryEntities({
      areas: parseStringArray(raw.areas),
      amenities: parseStringArray(raw.amenities),
      deskTypes: parseStringArray(raw.deskTypes),
      landmarks: parseStringArray(raw.landmarks),
      budgetSignals: parseStringArray(raw.budgetSignals),
    });
  } catch {
    return emptyQueryEntities();
  }
}

export const EXTRACT_SYSTEM = `You extract coworking space entities from Bangalore search text.
Return only JSON with this shape:
{
  "areas": [],
  "amenities": [],
  "deskTypes": [],
  "landmarks": [],
  "budgetSignals": []
}
Use only the values that appear in the text or are directly implied.
Do not invent locations or amenities.
Keep responses short and machine-readable.
If the text begins with a LISTING_ID: line, ignore that line entirely — it is metadata, not content.`;

export function parseExtractedEntitiesJson(raw: string): QueryEntities {
  try {
    return parseExtractedEntities(JSON.parse(raw));
  } catch {
    return emptyQueryEntities();
  }
}

export const EXTRACT_BATCH_SYSTEM = `You extract coworking space entities from Bangalore search text.
You will receive a JSON array of listing texts under "items".
Return only JSON with this shape:
{
  "results": [
    { "areas": [], "amenities": [], "deskTypes": [], "landmarks": [], "budgetSignals": [] }
  ]
}
Return exactly one result per item in "items", in the same order — no more, no fewer.
Use only the values that appear in each item's text or are directly implied by it.
Do not invent locations or amenities. Do not mix entities across items.
Keep responses short and machine-readable.`;

// ponytail: batch parsing always returns exactly `expectedCount` entries (padding
// with empty entities on short/malformed model output) so callers can zip results
// back onto their input array by index without extra bounds checks.
export function parseExtractedEntitiesBatchJson(raw: string, expectedCount: number): QueryEntities[] {
  let results: unknown[] = [];
  try {
    const parsed = JSON.parse(raw) as { results?: unknown };
    if (Array.isArray(parsed.results)) results = parsed.results;
  } catch {
    results = [];
  }
  return Array.from({ length: expectedCount }, (_, i) => parseExtractedEntities(results[i]));
}
