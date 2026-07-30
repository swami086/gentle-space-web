import type { PublicListing } from "./public";

export type SpacesFilterState = {
  deskTypes: string[];
  areas: string[];
  amenities: string[];
};

export const EMPTY_FILTERS: SpacesFilterState = {
  deskTypes: [],
  areas: [],
  amenities: [],
};

export function applySpacesFilters(
  listings: PublicListing[],
  filters: SpacesFilterState,
): PublicListing[] {
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
  return [...filters.deskTypes, ...filters.areas, ...filters.amenities];
}
