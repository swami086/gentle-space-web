import { approximateCoords } from "./approximateCoords";
import { redactSensitiveText, sanitizeArea } from "./redact";
import type { Listing, ListingSource } from "./types";

export const APPROX_RADIUS_M = 500;

export type PublicListing = {
  id: string;
  source: ListingSource;
  slug: string;
  title: string;
  description: string;
  shortTeaser: string;
  area: string;
  city: string;
  approxLat: number | null;
  approxLng: number | null;
  approxRadiusM: number;
  amenities: string[];
  images: string[];
  propertyType: string | null;
  syncedAt: string;
  address?: never;
  pricingHint?: never;
  sourceUrl?: never;
  lat?: never;
  lng?: never;
  sourceId?: never;
};

function roundCoord(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function toPublicListing(listing: Listing): PublicListing {
  let approxLat: number | null = null;
  let approxLng: number | null = null;
  if (listing.lat != null && listing.lng != null) {
    const offset = approximateCoords(listing.lat, listing.lng, listing.id);
    approxLat = roundCoord(offset.lat);
    approxLng = roundCoord(offset.lng);
  }

  return {
    id: listing.id,
    source: listing.source,
    slug: listing.slug,
    title: listing.title,
    description: redactSensitiveText(listing.description),
    shortTeaser: redactSensitiveText(listing.shortTeaser),
    area: sanitizeArea(listing.area),
    city: listing.city,
    approxLat,
    approxLng,
    approxRadiusM: APPROX_RADIUS_M,
    amenities: listing.amenities,
    images: listing.images,
    propertyType: listing.propertyType,
    syncedAt: listing.syncedAt,
  };
}
