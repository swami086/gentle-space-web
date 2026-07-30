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
Keep responses short and machine-readable.`;

export function parseExtractedEntitiesJson(raw: string): QueryEntities {
  try {
    return parseExtractedEntities(JSON.parse(raw));
  } catch {
    return emptyQueryEntities();
  }
}
