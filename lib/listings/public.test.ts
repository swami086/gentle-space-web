import { describe, expect, it } from "vitest";
import { haversineMeters } from "../places/distance";
import { toPublicListing, APPROX_RADIUS_M } from "./public";
import type { Listing } from "./types";

const sample: Listing = {
  id: "listing-a",
  source: "coworker",
  sourceId: "src-1",
  slug: "cowrks-ecoworld",
  title: "CoWrks Ecoworld",
  description:
    "CoWrks is located at RMZ Ecoworld, Bellandur. High-speed wireless internet is available.",
  shortTeaser: "Located at RMZ Ecoworld, Bellandur.",
  address: "Bellandur, Bengaluru, Karnataka 560103, India",
  area: "Bellandur",
  city: "Bengaluru",
  lat: 12.9352,
  lng: 77.6245,
  amenities: ["Wi-Fi"],
  images: ["https://example.com/a.jpg"],
  pricingHint: "₹ 20000/month",
  propertyType: "Coworking",
  sourceUrl: "https://example.com/listing",
  syncedAt: "2026-07-30T00:00:00.000Z",
};

describe("toPublicListing", () => {
  it("omits forbidden keys from the object", () => {
    const pub = toPublicListing(sample);
    for (const key of ["address", "pricingHint", "lat", "lng", "sourceUrl", "sourceId"] as const) {
      expect(key in pub).toBe(false);
    }
  });

  it("offsets and rounds approximates inside the privacy radius", () => {
    const pub = toPublicListing(sample);
    expect(pub.approxRadiusM).toBe(APPROX_RADIUS_M);
    expect(pub.approxLat).not.toBeNull();
    expect(pub.approxLng).not.toBeNull();
    expect(pub.approxLat).not.toBe(sample.lat);
    expect(pub.approxLng).not.toBe(sample.lng);
    // 3 decimal places
    expect(String(pub.approxLat)).toMatch(/^-?\d+\.\d{1,3}$/);
    const meters = haversineMeters(
      { lat: sample.lat!, lng: sample.lng! },
      { lat: pub.approxLat!, lng: pub.approxLng! },
    );
    expect(meters).toBeLessThanOrEqual(APPROX_RADIUS_M);
    expect(meters).toBeGreaterThan(0);
  });

  it("nulls approximates when coords missing", () => {
    const pub = toPublicListing({ ...sample, lat: null, lng: null });
    expect(pub.approxLat).toBeNull();
    expect(pub.approxLng).toBeNull();
    expect(pub.approxRadiusM).toBe(APPROX_RADIUS_M);
  });

  it("redacts prose and sanitizes area", () => {
    const pub = toPublicListing(sample);
    expect(pub.description.toLowerCase()).not.toContain("located at");
    expect(pub.shortTeaser).toBe("");
    expect(pub.area).toBe("Bellandur");
  });
});
