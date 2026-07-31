import { parseStoredPrice } from "./sources/price";

export const BANGALORE_CITY_CENTROID = { lat: 12.9629, lng: 77.5775 } as const;
const CENTROID_EPS = 0.0005;

export type EnrichCandidate = {
  id: string;
  title: string;
  sourceUrl: string;
  area: string;
  address: string;
  pricingHint: string | null;
  lat: number | null;
  lng: number | null;
  syncedAt: string;
};

export function isAtCityCentroid(lat: number | null, lng: number | null): boolean {
  if (lat == null || lng == null) return false;
  return (
    Math.abs(lat - BANGALORE_CITY_CENTROID.lat) < CENTROID_EPS &&
    Math.abs(lng - BANGALORE_CITY_CENTROID.lng) < CENTROID_EPS
  );
}

export function isPricingWeak(pricingHint: string | null | undefined): boolean {
  const parsed = parseStoredPrice(pricingHint);
  return parsed == null || parsed.monthlyInr == null;
}

export function isWeakListing(row: EnrichCandidate): boolean {
  const emptyLoc = row.area.trim() === "" && row.address.trim() === "";
  return emptyLoc || isAtCityCentroid(row.lat, row.lng) || isPricingWeak(row.pricingHint);
}

