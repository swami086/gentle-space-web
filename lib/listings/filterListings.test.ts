import { describe, expect, it } from "vitest";
import {
  applySpacesFilters,
  parsePricingHintInr,
  activeFilterChips,
  EMPTY_FILTERS,
  type SpacesFilterState,
} from "./filterListings";
import type { Listing } from "./types";

function listing(partial: Partial<Listing> & Pick<Listing, "id" | "title">): Listing {
  return {
    source: "coworker",
    sourceId: partial.id,
    slug: partial.id,
    description: "",
    shortTeaser: "",
    address: "",
    area: "",
    city: "Bangalore",
    lat: null,
    lng: null,
    amenities: [],
    images: [],
    pricingHint: null,
    propertyType: null,
    sourceUrl: "https://example.com",
    syncedAt: "2026-07-26T00:00:00.000Z",
    ...partial,
  };
}

describe("parsePricingHintInr", () => {
  it("parses From ₹18,500/mo", () => {
    expect(parsePricingHintInr("From ₹18,500/mo")).toBe(18500);
  });

  it("returns null when missing", () => {
    expect(parsePricingHintInr(null)).toBeNull();
  });
});

describe("applySpacesFilters", () => {
  const rows = [
    listing({
      id: "1",
      title: "A",
      area: "Koramangala",
      propertyType: "Private cabin",
      pricingHint: "From ₹12,000/mo",
      amenities: ["Near Metro", "Parking"],
    }),
    listing({
      id: "2",
      title: "B",
      area: "HSR Layout",
      propertyType: "Hot desk",
      pricingHint: "From ₹8,000/mo",
      amenities: ["Wi-Fi"],
    }),
  ];

  it("returns all for EMPTY_FILTERS", () => {
    expect(applySpacesFilters(rows, EMPTY_FILTERS)).toHaveLength(2);
  });

  it("filters by area and desk type", () => {
    const filters: SpacesFilterState = {
      ...EMPTY_FILTERS,
      areas: ["Koramangala"],
      deskTypes: ["Private cabin"],
    };
    expect(applySpacesFilters(rows, filters).map((l) => l.id)).toEqual(["1"]);
  });

  it("filters by budget max", () => {
    const filters: SpacesFilterState = { ...EMPTY_FILTERS, budgetMax: 10000 };
    expect(applySpacesFilters(rows, filters).map((l) => l.id)).toEqual(["2"]);
  });

  it("filters by amenity substring", () => {
    const filters: SpacesFilterState = { ...EMPTY_FILTERS, amenities: ["metro"] };
    expect(applySpacesFilters(rows, filters).map((l) => l.id)).toEqual(["1"]);
  });
});

describe("activeFilterChips", () => {
  it("lists human labels", () => {
    const chips = activeFilterChips({
      deskTypes: ["Private cabin"],
      areas: ["Koramangala"],
      budgetMin: null,
      budgetMax: 15000,
      amenities: ["Near Metro"],
    });
    expect(chips).toContain("Private cabin");
    expect(chips).toContain("Koramangala");
    expect(chips.some((c) => c.includes("15,000") || c.includes("15000"))).toBe(true);
    expect(chips).toContain("Near Metro");
  });
});
