import { getPool } from "../db/client";
import { cleanAddress, hasCityMarker } from "../listings/address";
import { sanitizeArea } from "../listings/redact";

const BLR = { latMin: 12.7, latMax: 13.3, lngMin: 77.3, lngMax: 77.9 };

export type GeocodeListingRow = {
  id: string;
  title: string;
  area: string;
  address: string;
  city: string;
};

export type GeocodeCoords = { lat: number; lng: number };

export function inBangalore(lat: number, lng: number): boolean {
  return lat >= BLR.latMin && lat <= BLR.latMax && lng >= BLR.lngMin && lng <= BLR.lngMax;
}

/**
 * Google answers an unresolvable query with the city itself, at the city centroid. That
 * is never a usable listing location, and `partial_match` does not flag it — the reliable
 * signal is the formatted address being nothing but city/state/country.
 */
function isBareCity(formattedAddress: string | undefined): boolean {
  if (!formattedAddress) return false;
  return /^(?:Bengaluru|Bangalore)(?:,\s*Karnataka)?(?:,\s*India)?$/i.test(formattedAddress.trim());
}

/**
 * Geocoding candidates, most reliable first, to be tried in order until one resolves.
 *
 * A full postal address resolves at rooftop precision. A locality name resolves to a
 * locality centroid — coarse but always correct. A bare landmark phrase ("Post Office",
 * "Above ICICI Bank") is scraped into `address` by some sources and is usually
 * unresolvable, so it ranks *below* the locality; ranking it above parked 32 listings at
 * the city centroid. A title resolves to whichever branch of a multi-branch brand Google
 * guesses, so it is last.
 */
export function geocodeCandidates(
  row: Pick<GeocodeListingRow, "title" | "area" | "address" | "city">,
): string[] {
  const city = (row.city || "Bengaluru").trim() || "Bengaluru";
  const address = cleanAddress(row.address ?? "");
  const area = sanitizeArea(row.area);
  const title = row.title.trim();

  const candidates = [
    address && hasCityMarker(address) ? address : "",
    area ? `${area}, ${city}, India` : "",
    address && !hasCityMarker(address) ? `${address}, ${city}, India` : "",
    title ? `${title}, ${city}, India` : "",
  ];
  return candidates.filter(Boolean);
}

export function geocodeQuery(
  row: Pick<GeocodeListingRow, "title" | "area" | "address" | "city">,
): string | null {
  return geocodeCandidates(row)[0] ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function geocodeAddress(
  query: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodeCoords | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("region", "in");

  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`geocode HTTP ${res.status} for ${query}`);
  }
  const body = (await res.json()) as {
    status: string;
    results?: Array<{
      formatted_address?: string;
      geometry: { location: { lat: number; lng: number } };
    }>;
  };
  if (body.status === "ZERO_RESULTS") return null;
  if (body.status === "OVER_QUERY_LIMIT" || body.status === "RESOURCE_EXHAUSTED") {
    throw new Error(`geocode quota: ${body.status}`);
  }
  if (body.status !== "OK" || !body.results?.[0]) {
    console.warn(`geocode skip (${body.status}): ${query}`);
    return null;
  }
  const top = body.results[0];
  if (isBareCity(top.formatted_address)) {
    console.warn(`geocode collapsed to bare city, rejecting: ${query}`);
    return null;
  }
  const { lat, lng } = top.geometry.location;
  if (!inBangalore(lat, lng)) {
    console.warn(`geocode out of Bangalore: ${query} → ${lat},${lng}`);
    return null;
  }
  return { lat, lng };
}

/** Tries candidates in priority order, returning the first that resolves usefully. */
export async function geocodeFirstMatch(
  candidates: string[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  pauseMs = 0,
): Promise<GeocodeCoords | null> {
  for (const [index, query] of candidates.entries()) {
    if (index > 0 && pauseMs > 0) await sleep(pauseMs);
    const coords = await geocodeAddress(query, apiKey, fetchImpl);
    if (coords) return coords;
  }
  return null;
}

export type GeocodeMissingResult = {
  updated: number;
  skipped: number;
  failed: number;
  scanned: number;
};

/**
 * Fill null lat/lng via Geocoding API from sanitized area+city (Bangalore bbox).
 * Soft-safe to call from sync: returns zeros when key/DB unset.
 */
export async function geocodeListingsMissingCoords(options?: {
  limit?: number;
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
  pauseMs?: number;
}): Promise<GeocodeMissingResult> {
  const apiKey = options?.apiKey ?? process.env.GOOGLE_GEOCODING_API_KEY ?? null;
  if (!apiKey || !process.env.DATABASE_URL) {
    return { updated: 0, skipped: 0, failed: 0, scanned: 0 };
  }

  const limit = options?.limit ?? (Number(process.env.GEOCODE_LIMIT || "0") || 0);
  const pauseMs = options?.pauseMs ?? 200;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const pool = getPool();

  const { rows } = await pool.query<GeocodeListingRow>(
    `SELECT id, title, area, address, city
     FROM listings
     WHERE lat IS NULL OR lng IS NULL
     ORDER BY synced_at DESC NULLS LAST
     ${limit > 0 ? `LIMIT ${Math.floor(limit)}` : ""}`,
  );

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const candidates = geocodeCandidates(row);
    if (candidates.length === 0) {
      skipped += 1;
      continue;
    }
    try {
      const coords = await geocodeFirstMatch(candidates, apiKey, fetchImpl, pauseMs);
      if (!coords) {
        skipped += 1;
      } else {
        await pool.query(`UPDATE listings SET lat = $1, lng = $2 WHERE id = $3`, [
          coords.lat,
          coords.lng,
          row.id,
        ]);
        updated += 1;
      }
    } catch (err) {
      failed += 1;
      console.error(err instanceof Error ? err.message : err);
      if (String(err).includes("quota")) break;
    }
    if (pauseMs > 0) await sleep(pauseMs);
  }

  return { updated, skipped, failed, scanned: rows.length };
}
