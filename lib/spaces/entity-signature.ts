import { normalizeQueryEntities } from "../graph/normalize";
import type { QueryEntities } from "../graph/types";

function sortedField(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

/** Client-safe canonical entity shape for signatures and cache fingerprints. */
export function canonicalizeQueryEntities(entities: QueryEntities): QueryEntities {
  const normalized = normalizeQueryEntities(entities);
  return {
    areas: sortedField(normalized.areas),
    amenities: sortedField(normalized.amenities),
    deskTypes: sortedField(normalized.deskTypes),
    landmarks: sortedField(normalized.landmarks),
    budgetSignals: sortedField(normalized.budgetSignals),
  };
}

export function entitySignature(entities: QueryEntities): string {
  const canonical = canonicalizeQueryEntities(entities);
  return JSON.stringify({
    areas: canonical.areas,
    amenities: canonical.amenities,
    deskTypes: canonical.deskTypes,
    landmarks: canonical.landmarks,
    budgetSignals: canonical.budgetSignals,
  });
}
