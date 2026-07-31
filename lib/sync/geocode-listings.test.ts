import { describe, expect, it, vi } from "vitest";
import {
  geocodeAddress,
  geocodeCandidates,
  geocodeQuery,
  inBangalore,
  geocodeListingsMissingCoords,
} from "./geocode-listings";

describe("geocodeCandidates", () => {
  it("ranks a resolvable locality above an unresolvable landmark phrase", () => {
    // Regression: "Post Office" outranked "Whitefield" and resolved to the city centroid.
    expect(
      geocodeCandidates({
        title: "Share Space - Open Desks",
        area: "Whitefield",
        address: "Post Office",
        city: "Bengaluru",
      }),
    ).toEqual([
      "Whitefield, Bengaluru, India",
      "Post Office, Bengaluru, India",
      "Share Space - Open Desks, Bengaluru, India",
    ]);
  });

  it("puts a full postal address first", () => {
    expect(
      geocodeCandidates({
        title: "Hustlehub",
        area: "HSR Layout",
        address: "#108, 27th Main Road, Sector 2, HSR Layout, Bengaluru, Karnataka 560102, India",
        city: "Bengaluru",
      })[0],
    ).toBe("#108, 27th Main Road, Sector 2, HSR Layout, Bengaluru, Karnataka 560102, India");
  });

  it("omits candidates that have no usable text", () => {
    expect(geocodeCandidates({ title: "", area: "", address: "", city: "Bengaluru" })).toEqual([]);
    expect(
      geocodeCandidates({ title: "T", area: "Plot No: 4", address: "", city: "Bengaluru" }),
    ).toEqual(["T, Bengaluru, India"]);
  });
});

describe("geocodeQuery", () => {
  it("prefers the full postal address over the area centroid", () => {
    // An area name only ever resolves to a locality centroid; the full address resolves
    // at rooftop precision, which is the whole point of the repair.
    expect(
      geocodeQuery({
        title: "Hustlehub",
        area: "2nd & 3rd Floor",
        address:
          "2nd & 3rd Floor, #108, Opposite Corner House, 27th Main Road, Sector 2, HSR Layout, Bengaluru, Karnataka 560102, India",
        city: "Bengaluru",
      }),
    ).toBe(
      "2nd & 3rd Floor, #108, Opposite Corner House, 27th Main Road, Sector 2, HSR Layout, Bengaluru, Karnataka 560102, India",
    );
  });

  it("strips the scraper junk prefix before sending the address", () => {
    expect(
      geocodeQuery({
        title: "Unispace",
        area: "ap_marker.svg)   Metropolis Office Park Plot No: 128-P2",
        address:
          "ap_marker.svg)   Metropolis Office Park Plot No: 128-P2, EPIP ZONE, Industrial Area, Whitefield, Bengaluru, Karnataka 560066, India",
        city: "Bengaluru",
      }),
    ).toBe(
      "Metropolis Office Park Plot No: 128-P2, EPIP ZONE, Industrial Area, Whitefield, Bengaluru, Karnataka 560066, India",
    );
  });

  it("qualifies a landmark-only address with the city", () => {
    expect(
      geocodeQuery({
        title: "Some Space",
        area: "",
        address: "Near By Trinity Metro Station",
        city: "Bengaluru",
      }),
    ).toBe("Near By Trinity Metro Station, Bengaluru, India");
  });

  it("prefers sanitized area + city", () => {
    expect(geocodeQuery({ title: "Space", area: "Bellandur", address: "", city: "Bengaluru" })).toBe(
      "Bellandur, Bengaluru, India",
    );
  });

  it("strips scraper svg junk then uses locality", () => {
    expect(
      geocodeQuery({
        title: "Intide",
        area: "ap_marker.svg)   BNR Complex",
        address: "",
        city: "Bengaluru",
      }),
    ).toBe("BNR Complex, Bengaluru, India");
  });

  it("falls back to title when area sanitizes empty and there is no address", () => {
    expect(
      geocodeQuery({
        title: "WeWork Prestige",
        area: "Metropolis Office Park Plot No: 128-P2",
        address: "",
        city: "Bengaluru",
      }),
    ).toBe("WeWork Prestige, Bengaluru, India");
  });

  it("returns null when nothing usable is present", () => {
    expect(geocodeQuery({ title: "", area: "", address: "", city: "Bengaluru" })).toBeNull();
  });
});

describe("inBangalore", () => {
  it("accepts Koramangala and rejects Mumbai", () => {
    expect(inBangalore(12.93, 77.62)).toBe(true);
    expect(inBangalore(19.07, 72.87)).toBe(false);
  });
});

describe("geocodeAddress", () => {
  it("returns coords for OK Bangalore results", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        status: "OK",
        results: [{ geometry: { location: { lat: 12.97, lng: 77.59 } } }],
      }),
    );
    await expect(geocodeAddress("Bellandur, Bengaluru, India", "key", fetchImpl)).resolves.toEqual({
      lat: 12.97,
      lng: 77.59,
    });
  });

  it("rejects a result that collapsed to the bare city", async () => {
    // Unresolvable landmark phrases resolve to "Bengaluru, Karnataka, India" at the city
    // centroid. Accepting that silently parks listings in the middle of the map.
    const fetchImpl = vi.fn(async () =>
      Response.json({
        status: "OK",
        results: [
          {
            formatted_address: "Bengaluru, Karnataka, India",
            types: ["locality", "political"],
            geometry: { location: { lat: 12.9629, lng: 77.5775 } },
          },
        ],
      }),
    );
    await expect(
      geocodeAddress("Above ICICI Bank, Bengaluru, India", "key", fetchImpl),
    ).resolves.toBeNull();
  });

  it("still accepts a locality result for a locality query", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        status: "OK",
        results: [
          {
            formatted_address: "Whitefield, Bengaluru, Karnataka, India",
            types: ["political", "sublocality"],
            geometry: { location: { lat: 12.9698, lng: 77.75 } },
          },
        ],
      }),
    );
    await expect(geocodeAddress("Whitefield, Bengaluru, India", "key", fetchImpl)).resolves.toEqual({
      lat: 12.9698,
      lng: 77.75,
    });
  });

  it("returns null for out-of-bbox results", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        status: "OK",
        results: [{ geometry: { location: { lat: 19.07, lng: 72.87 } } }],
      }),
    );
    await expect(geocodeAddress("Mumbai, India", "key", fetchImpl)).resolves.toBeNull();
  });

  it("throws on quota", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ status: "OVER_QUERY_LIMIT", results: [] }),
    );
    await expect(geocodeAddress("Bellandur, Bengaluru, India", "key", fetchImpl)).rejects.toThrow(
      /quota/,
    );
  });
});

describe("geocodeListingsMissingCoords", () => {
  it("no-ops without API key", async () => {
    const prev = process.env.GOOGLE_GEOCODING_API_KEY;
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://x";
    await expect(geocodeListingsMissingCoords({ apiKey: null })).resolves.toEqual({
      updated: 0,
      skipped: 0,
      failed: 0,
      scanned: 0,
    });
    if (prev === undefined) delete process.env.GOOGLE_GEOCODING_API_KEY;
    else process.env.GOOGLE_GEOCODING_API_KEY = prev;
  });
});
