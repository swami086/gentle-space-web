import { describe, expect, it } from "vitest";
import {
  applySpacesFilters,
  activeFilterChips,
  EMPTY_FILTERS,
  type SpacesFilterState,
} from "./filterListings";
import { toPublicListing } from "./public";
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

function publicListing(partial: Partial<Listing> & Pick<Listing, "id" | "title">) {
  return toPublicListing(listing(partial));
}

describe("applySpacesFilters", () => {
  const rows = [
    publicListing({
      id: "1",
      title: "A",
      area: "Koramangala",
      propertyType: "Private cabin",
      pricingHint: "From ₹12,000/mo",
      amenities: ["Near Metro", "Parking"],
    }),
    publicListing({
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
      amenities: ["Near Metro"],
    });
    expect(chips).toEqual(["Private cabin", "Koramangala", "Near Metro"]);
  });
});
