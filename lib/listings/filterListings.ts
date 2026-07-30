import type { Listing } from "./types";

export type SpacesFilterState = {
  deskTypes: string[];
  areas: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  amenities: string[];
};

export const EMPTY_FILTERS: SpacesFilterState = {
  deskTypes: [],
  areas: [],
  budgetMin: null,
  budgetMax: null,
  amenities: [],
};

export function parsePricingHintInr(hint: string | null): number | null {
  if (!hint) return null;

  const match = hint.replace(/,/g, "").match(/(\d{3,})/);
  return match ? Number(match[1]) : null;
}

export function applySpacesFilters(
  listings: Listing[],
  filters: SpacesFilterState,
): Listing[] {
  return listings.filter((listing) => {
    if (filters.deskTypes.length > 0) {
      const propertyType = (listing.propertyType ?? "").toLowerCase();
      if (
        !filters.deskTypes.some((deskType) =>
          propertyType.includes(deskType.toLowerCase()),
        )
      ) {
        return false;
      }
    }

    if (filters.areas.length > 0) {
      const area = listing.area.toLowerCase();
      if (!filters.areas.some((filterArea) => area === filterArea.toLowerCase())) {
        return false;
      }
    }

    const price = parsePricingHintInr(listing.pricingHint);
    if (filters.budgetMin != null && (price == null || price < filters.budgetMin)) {
      return false;
    }
    if (filters.budgetMax != null && (price == null || price > filters.budgetMax)) {
      return false;
    }

    if (filters.amenities.length > 0) {
      const amenities = listing.amenities.join(" ").toLowerCase();
      if (
        !filters.amenities.every((amenity) =>
          amenities.includes(amenity.toLowerCase()),
        )
      ) {
        return false;
      }
    }

    return true;
  });
}

export function activeFilterChips(filters: SpacesFilterState): string[] {
  const chips: string[] = [];

  chips.push(...filters.deskTypes);
  chips.push(...filters.areas);
  if (filters.budgetMin != null) {
    chips.push(`≥ ₹${filters.budgetMin.toLocaleString("en-IN")}`);
  }
  if (filters.budgetMax != null) {
    chips.push(`≤ ₹${filters.budgetMax.toLocaleString("en-IN")}`);
  }
  chips.push(...filters.amenities);

  return chips;
}
