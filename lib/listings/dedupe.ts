import { normalizeName } from "./normalize";
import { SOURCE_PRIORITY, type Listing } from "./types";

const EARTH_RADIUS_M = 6_371_000;

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function geoMatch(a: Listing, b: Listing): boolean {
  const aNull = a.lat === null || a.lng === null;
  const bNull = b.lat === null || b.lng === null;
  if (aNull && bNull) return true;
  if (aNull || bNull) return false;
  return haversineMeters(a.lat!, a.lng!, b.lat!, b.lng!) < 150;
}

function isDuplicate(a: Listing, b: Listing): boolean {
  return (
    normalizeName(a.title) === normalizeName(b.title) && geoMatch(a, b)
  );
}

export function dedupeListings(rows: Listing[]): Listing[] {
  const sorted = [...rows].sort(
    (a, b) => SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source],
  );
  const kept: Listing[] = [];
  for (const row of sorted) {
    if (!kept.some((k) => isDuplicate(k, row))) kept.push(row);
  }
  return kept;
}
