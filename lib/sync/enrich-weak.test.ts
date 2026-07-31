import { describe, expect, it } from "vitest";
import {
  isAtCityCentroid,
  isPricingWeak,
  isWeakListing,
} from "./enrich-weak";

const base = {
  id: "a",
  title: "WeWork",
  sourceUrl: "https://example.com/x",
  area: "HSR Layout",
  address: "1 Main, Bengaluru",
  pricingHint: "₹20,000/month",
  lat: 12.91,
  lng: 77.64,
  syncedAt: "2026-07-31T00:00:00.000Z",
};

describe("isAtCityCentroid", () => {
  it("matches the Bangalore city centroid within ~50 m", () => {
    expect(isAtCityCentroid(12.9629, 77.5775)).toBe(true);
    expect(isAtCityCentroid(12.9629 + 0.0004, 77.5775)).toBe(true);
    expect(isAtCityCentroid(12.91, 77.64)).toBe(false);
    expect(isAtCityCentroid(null, 77.5775)).toBe(false);
  });
});

describe("isWeakListing", () => {
  it("includes empty area+address", () => {
    expect(isWeakListing({ ...base, area: "", address: "  " })).toBe(true);
  });

  it("includes city-centroid coords even with a locality", () => {
    expect(isWeakListing({ ...base, lat: 12.9629, lng: 77.5775 })).toBe(true);
  });

  it("includes unparseable / non-monthly price", () => {
    expect(isWeakListing({ ...base, pricingHint: "Price on request" })).toBe(true);
    expect(isWeakListing({ ...base, pricingHint: "₹17,999/year" })).toBe(true);
  });

  it("excludes a healthy row", () => {
    expect(isWeakListing(base)).toBe(false);
  });
});

describe("isPricingWeak", () => {
  it("treats empty, unparseable, and non-monthly as weak", () => {
    expect(isPricingWeak(null)).toBe(true);
    expect(isPricingWeak("")).toBe(true);
    expect(isPricingWeak("ask")).toBe(true);
    expect(isPricingWeak("₹600/day")).toBe(false); // convertible monthly
    expect(isPricingWeak("₹20,000/month")).toBe(false);
  });
});

