const DAY_MS = 24 * 60 * 60 * 1000;

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function getListingDetailTtlMs(): number {
  return positiveInteger("LISTING_DETAIL_TTL_DAYS", 7) * DAY_MS;
}

export function getListingMissingRunsLimit(): number {
  return positiveInteger("LISTING_MISSING_RUNS_LIMIT", 3);
}
