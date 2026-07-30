import { createHash } from "node:crypto";
import { explainListingFit } from "../ai/client";
import { normalizeQueryEntities } from "../graph/normalize";
import { emptyQueryEntities, type QueryEntities } from "../graph/types";
import type { Listing } from "../listings/types";
import { selectNearbyCategories } from "../places/categories";
import { isPlacesConfigured, searchNearby } from "../places/client";
import { distanceLabel } from "../places/distance";
import type { NearbyCategory, NearbyGroup } from "../places/types";
import { cacheKey, getCached, setCached, singleFlight } from "./insight-cache";
import type { InsightContent, InsightResponse } from "./insight-types";

const NEARBY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const INSIGHT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DESCRIPTION_CHARS = 600;

function sortedList(values: string[]): string {
  return [...values].sort().join("\x1f");
}

function canonicalNearby(nearby: NearbyGroup[]): string {
  return [...nearby]
    .sort((a, b) => a.category.localeCompare(b.category))
    .map((group) => {
      const places = [...group.places]
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name) || a.distanceLabel.localeCompare(b.distanceLabel),
        )
        .map((place) => `${place.name}@${place.distanceLabel}`)
        .join(",");
      return `${group.category}:${group.label}:${places}`;
    })
    .join("\x1e");
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function insightFingerprint(input: {
  query: string;
  entities: QueryEntities;
  listing: Pick<
    Listing,
    "title" | "area" | "city" | "propertyType" | "pricingHint" | "amenities" | "description"
  >;
  nearby: NearbyGroup[];
}): string {
  const entities = normalizeQueryEntities(input.entities);
  const parts = [
    normalizeQuery(input.query),
    sortedList(entities.areas),
    sortedList(entities.amenities),
    sortedList(entities.deskTypes),
    sortedList(entities.landmarks),
    sortedList(entities.budgetSignals),
    input.listing.title,
    input.listing.area,
    input.listing.city,
    input.listing.propertyType ?? "",
    input.listing.pricingHint ?? "",
    sortedList(input.listing.amenities),
    input.listing.description.slice(0, MAX_DESCRIPTION_CHARS),
    canonicalNearby(input.nearby),
  ];
  return createHash("sha256").update(parts.join("\x00")).digest("hex");
}

export function entitySignature(entities: QueryEntities): string {
  const normalized = normalizeQueryEntities(entities);
  return [
    normalized.areas,
    normalized.amenities,
    normalized.deskTypes,
    normalized.landmarks,
    normalized.budgetSignals,
  ]
    .map((list) => sortedList(list))
    .join(";");
}

async function fetchNearbyGroups(
  listing: Listing,
  categories: NearbyCategory[],
): Promise<NearbyGroup[]> {
  const origin = { lat: listing.lat!, lng: listing.lng! };
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

  return groups;
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

  return singleFlight(key, async () => {
    const recheck = getCached<NearbyGroup[]>(key);
    if (recheck) return recheck;

    const groups = await fetchNearbyGroups(listing, categories);
    setCached(key, NEARBY_TTL_MS, groups);
    return groups;
  });
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

  const fingerprint = insightFingerprint({
    query: input.query,
    entities,
    listing: input.listing,
    nearby,
  });
  const key = cacheKey("insight", [input.listing.id, fingerprint]);

  let content = getCached<InsightContent>(key);
  if (!content) {
    content = await singleFlight(key, async () => {
      const recheck = getCached<InsightContent>(key);
      if (recheck) return recheck;

      const generated = await explainListingFit({
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
      if (generated.summary || generated.highlights.length > 0) {
        setCached(key, INSIGHT_TTL_MS, generated);
      }
      return generated;
    });
  }

  return {
    listingId: input.listing.id,
    summary: content.summary,
    highlights: content.highlights,
    nearby,
  };
}
