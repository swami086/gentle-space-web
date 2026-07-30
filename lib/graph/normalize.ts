import type { QueryEntities } from "./types";

export function normalizeEntityName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeEntityList(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    const v = normalizeEntityName(n);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function normalizeQueryEntities(raw: QueryEntities): QueryEntities {
  return {
    areas: normalizeEntityList(raw.areas),
    amenities: normalizeEntityList(raw.amenities),
    deskTypes: normalizeEntityList(raw.deskTypes),
    landmarks: normalizeEntityList(raw.landmarks),
    budgetSignals: normalizeEntityList(raw.budgetSignals),
  };
}
