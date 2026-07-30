import type { QueryEntities } from "../graph/types";
import type { NearbyCategory } from "./types";

export const MAX_CATEGORIES = 3;

const TRANSIT: NearbyCategory = {
  key: "transit",
  label: "Transit",
  includedTypes: ["subway_station", "transit_station"],
};
const RESTAURANT: NearbyCategory = {
  key: "restaurant",
  label: "Food",
  includedTypes: ["restaurant"],
};
const ATM: NearbyCategory = { key: "atm", label: "ATMs", includedTypes: ["atm"] };

// Rule order defines output order, which keeps the nearby cache key stable.
const CATEGORY_RULES: { match: RegExp; category: NearbyCategory }[] = [
  { match: /\b(metro|subway|station|transit|rail)\b/, category: TRANSIT },
  { match: /\b(coffee|cafe|café|barista)\b/, category: { key: "cafe", label: "Cafes", includedTypes: ["cafe"] } },
  { match: /\b(food|lunch|restaurant|dining|eat)\b/, category: RESTAURANT },
  { match: /\b(gym|fitness|workout)\b/, category: { key: "gym", label: "Gyms", includedTypes: ["gym"] } },
  { match: /\b(parking|car park)\b/, category: { key: "parking", label: "Parking", includedTypes: ["parking"] } },
  { match: /\b(bank|atm)\b/, category: ATM },
  { match: /\b(airport)\b/, category: { key: "airport", label: "Airport", includedTypes: ["airport"] } },
  { match: /\b(mall|shopping)\b/, category: { key: "mall", label: "Shopping", includedTypes: ["shopping_mall"] } },
];

export const DEFAULT_CATEGORIES: NearbyCategory[] = [TRANSIT, RESTAURANT, ATM];

export function selectNearbyCategories(entities: QueryEntities): NearbyCategory[] {
  const haystack = [...entities.landmarks, ...entities.amenities, ...entities.deskTypes]
    .join(" ")
    .toLowerCase();

  const picked: NearbyCategory[] = [];
  const seen = new Set<string>();

  for (const rule of CATEGORY_RULES) {
    if (picked.length >= MAX_CATEGORIES) break;
    if (!rule.match.test(haystack)) continue;
    if (seen.has(rule.category.key)) continue;
    seen.add(rule.category.key);
    picked.push(rule.category);
  }

  return picked.length > 0 ? picked : DEFAULT_CATEGORIES;
}
