import { describe, expect, it } from "vitest";
import { emptyQueryEntities } from "../graph/types";
import { DEFAULT_CATEGORIES, MAX_CATEGORIES, selectNearbyCategories } from "./categories";

describe("selectNearbyCategories", () => {
  it("maps query cues to places types", () => {
    const picked = selectNearbyCategories({
      ...emptyQueryEntities(),
      landmarks: ["Metro station"],
      amenities: ["coffee"],
    });

    expect(picked.map((c) => c.key)).toEqual(["transit", "cafe"]);
    expect(picked[0].includedTypes).toContain("subway_station");
    expect(picked[1].includedTypes).toEqual(["cafe"]);
    expect(picked[0].label).toBe("Transit");
  });

  it("falls back to the default commuter set when the query implies nothing", () => {
    expect(selectNearbyCategories(emptyQueryEntities())).toEqual(DEFAULT_CATEGORIES);
  });

  it("dedupes and caps at MAX_CATEGORIES with stable order", () => {
    const picked = selectNearbyCategories({
      ...emptyQueryEntities(),
      landmarks: ["metro", "subway"],
      amenities: ["cafe", "coffee", "gym", "parking", "atm"],
    });

    expect(picked).toHaveLength(MAX_CATEGORIES);
    expect(picked.map((c) => c.key)).toEqual(["transit", "cafe", "gym"]);
  });
});
