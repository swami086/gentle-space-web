import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPlacesConfigured, searchNearby } from "./client";

const CATEGORY = { key: "cafe", label: "Cafes", includedTypes: ["cafe"] };
const ORIGIN = { lat: 12.93, lng: 77.68 };

beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
});

afterEach(() => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  vi.unstubAllGlobals();
});

describe("isPlacesConfigured", () => {
  it("is false without a key", () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    expect(isPlacesConfigured()).toBe(false);
  });

  it("is true with a key", () => {
    expect(isPlacesConfigured()).toBe(true);
  });
});

describe("searchNearby", () => {
  it("sends a field-masked request and parses places sorted by distance", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          { displayName: { text: "Far Cafe" }, location: { latitude: 12.938, longitude: 77.68 } },
          { displayName: { text: "Near Cafe" }, location: { latitude: 12.931, longitude: 77.68 } },
          { displayName: { text: "" }, location: { latitude: 12.932, longitude: 77.68 } },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const places = await searchNearby(ORIGIN, CATEGORY);

    expect(places.map((p) => p.name)).toEqual(["Near Cafe", "Far Cafe"]);
    expect(places[0].distanceMeters).toBeLessThan(places[1].distanceMeters);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchNearby");
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(init.headers["X-Goog-FieldMask"]).toBe(
      "places.displayName,places.location,places.primaryType",
    );
    expect(JSON.parse(init.body)).toEqual({
      includedTypes: ["cafe"],
      maxResultCount: 3,
      locationRestriction: {
        circle: { center: { latitude: 12.93, longitude: 77.68 }, radius: 1000 },
      },
    });
  });

  it("throws when the API responds with an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "denied" }),
    );

    await expect(searchNearby(ORIGIN, CATEGORY)).rejects.toThrow("places searchNearby failed: 403");
  });
});
