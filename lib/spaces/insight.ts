import { createHash } from "node:crypto";
import { explainListingFit } from "../ai/client";
import type { QueryEntities } from "../graph/types";
import { redactSensitiveText, sanitizeArea } from "../listings/redact";
import type { Listing } from "../listings/types";
import { selectNearbyCategories } from "../places/categories";
import { isPlacesConfigured, searchNearby } from "../places/client";
import { distanceBand } from "../places/distance";
import type { NearbyCategory, NearbyGroup } from "../places/types";
import { canonicalizeQueryEntities } from "./entity-signature";
import { cacheKey, getCached, setCached, singleFlight } from "./insight-cache";
import type { InsightContent, InsightResponse } from "./insight-types";

const NEARBY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const INSIGHT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DESCRIPTION_CHARS = 600;

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function canonicalNearbyPayload(nearby: NearbyGroup[]) {
  return [...nearby]
    .sort((a, b) => a.category.localeCompare(b.category))
    .map((group) => ({
      category: group.category,
      label: group.label,
      places: [...group.places]
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name) || a.distanceLabel.localeCompare(b.distanceLabel),
        )
        .map((place) => [place.name, place.distanceLabel] as [string, string]),
    }));
}

export function insightFingerprint(input: {
  query: string;
  entities: QueryEntities;
  listing: Pick<
    Listing,
    "title" | "area" | "city" | "propertyType" | "amenities" | "description"
  >;
  nearby: NearbyGroup[];
}): string {
  const payload = {
    query: normalizeQuery(input.query),
    entities: canonicalizeQueryEntities(input.entities),
    listing: {
      title: input.listing.title,
      area: sanitizeArea(input.listing.area),
      city: input.listing.city,
      propertyType: input.listing.propertyType ?? "",
      amenities: [...input.listing.amenities].sort((a, b) => a.localeCompare(b)),
      description: redactSensitiveText(input.listing.description).slice(0, MAX_DESCRIPTION_CHARS),
    },
    nearby: canonicalNearbyPayload(input.nearby),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
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
        distanceLabel: distanceBand(place.distanceMeters),
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
  const entities = input.entities ?? {
    areas: [],
    amenities: [],
    deskTypes: [],
    landmarks: [],
    budgetSignals: [],
  };
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
        area: sanitizeArea(input.listing.area),
        city: input.listing.city,
        propertyType: input.listing.propertyType,
        amenities: input.listing.amenities,
        description: redactSensitiveText(input.listing.description),
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
