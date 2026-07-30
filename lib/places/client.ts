import { haversineMeters } from "./distance";
import type { NearbyCategory, NearbyPlace } from "./types";

const PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby";
const FIELD_MASK = "places.displayName,places.location,places.primaryType";
const RADIUS_METERS = 1000;
const MAX_PER_CATEGORY = 3;
export const PLACES_NEARBY_TIMEOUT_MS = 5_000;

function apiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set");
  return key;
}

export function isPlacesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

export async function searchNearby(
  origin: { lat: number; lng: number },
  category: NearbyCategory,
): Promise<NearbyPlace[]> {
  const res = await fetch(PLACES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: category.includedTypes,
      maxResultCount: MAX_PER_CATEGORY,
      locationRestriction: {
        circle: {
          center: { latitude: origin.lat, longitude: origin.lng },
          radius: RADIUS_METERS,
        },
      },
    }),
    signal: AbortSignal.timeout(PLACES_NEARBY_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`places searchNearby failed: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as {
    places?: {
      displayName?: { text?: string };
      location?: { latitude: number; longitude: number };
    }[];
  };

  const places: NearbyPlace[] = [];
  for (const place of body.places ?? []) {
    const name = place.displayName?.text?.trim();
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    places.push({
      name,
      distanceMeters: haversineMeters(origin, { lat: lat!, lng: lng! }),
    });
  }

  return places.sort((a, b) => a.distanceMeters - b.distanceMeters);
}
