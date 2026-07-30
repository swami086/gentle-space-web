import { explainListingFit } from "../ai/client";
import { normalizeQueryEntities } from "../graph/normalize";
import { emptyQueryEntities, type QueryEntities } from "../graph/types";
import type { Listing } from "../listings/types";
import { selectNearbyCategories } from "../places/categories";
import { isPlacesConfigured, searchNearby } from "../places/client";
import { distanceLabel } from "../places/distance";
import type { NearbyCategory, NearbyGroup } from "../places/types";
import { cacheKey, getCached, setCached } from "./insight-cache";
import type { InsightContent, InsightResponse } from "./insight-types";

const NEARBY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const INSIGHT_TTL_MS = 24 * 60 * 60 * 1000;

function querySignature(entities: QueryEntities): string {
  const normalized = normalizeQueryEntities(entities);
  return [
    normalized.areas.join(","),
    normalized.amenities.join(","),
    normalized.deskTypes.join(","),
    normalized.landmarks.join(","),
    normalized.budgetSignals.join(","),
  ].join(";");
}

async function loadNearby(
  listing: Listing,
  categories: NearbyCategory[],
): Promise<NearbyGroup[]> {
  if (listing.lat == null || listing.lng == null) return [];
  if (!isPlacesConfigured()) return [];

  const key = cacheKey("nearby", [listing.id, categories.map((c) => c.key).join(",")]);
  const cached = getCached<NearbyGroup[]>(key);
  if (cached) return cached;

  const origin = { lat: listing.lat, lng: listing.lng };
  const groups: NearbyGroup[] = [];

  for (const category of categories) {
    const places = await searchNearby(origin, category);
    if (places.length === 0) continue;
    groups.push({
      category: category.key,
      label: category.label,
      places: places.map((place) => ({
        name: place.name,
        distanceLabel: distanceLabel(place.distanceMeters),
      })),
    });
  }

  setCached(key, NEARBY_TTL_MS, groups);
  return groups;
}

export async function buildInsight(input: {
  listing: Listing;
  query: string;
  entities?: QueryEntities;
}): Promise<InsightResponse> {
  const entities = input.entities ?? emptyQueryEntities();
  const categories = selectNearbyCategories(entities);

  let nearby: NearbyGroup[] = [];
  try {
    nearby = await loadNearby(input.listing, categories);
  } catch (error) {
    console.error("nearby lookup failed", error);
    nearby = [];
  }

  const key = cacheKey("insight", [
    input.listing.id,
    querySignature(entities),
    String(nearby.length),
  ]);

  let content = getCached<InsightContent>(key);
  if (!content) {
    content = await explainListingFit({
      title: input.listing.title,
      area: input.listing.area,
      city: input.listing.city,
      propertyType: input.listing.propertyType,
      pricingHint: input.listing.pricingHint,
      amenities: input.listing.amenities,
      description: input.listing.description,
      query: input.query,
      nearby,
    });
    if (content.summary || content.highlights.length > 0) {
      setCached(key, INSIGHT_TTL_MS, content);
    }
  }

  return {
    listingId: input.listing.id,
    summary: content.summary,
    highlights: content.highlights,
    nearby,
  };
}
