import { describe, expect, it } from "vitest";
import { normalizeEntityName, normalizeEntityList, normalizeQueryEntities } from "./normalize";

describe("normalizeEntityName", () => {
  it("trims, lowercases, collapses whitespace", () => {
    expect(normalizeEntityName("  Koramangala   5th  Block ")).toBe("koramangala 5th block");
  });
});

describe("normalizeEntityList", () => {
  it("dedupes after normalize", () => {
    expect(normalizeEntityList(["WiFi", " wifi ", "", "AC"])).toEqual(["wifi", "ac"]);
  });
});

describe("normalizeQueryEntities", () => {
  it("normalizes all buckets", () => {
    expect(
      normalizeQueryEntities({
        areas: [" Indiranagar "],
        amenities: ["Parking"],
        deskTypes: ["Private Cabin"],
        landmarks: ["  Metro "],
        budgetSignals: ["Under_15k"],
      }),
    ).toEqual({
      areas: ["indiranagar"],
      amenities: ["parking"],
      deskTypes: ["private cabin"],
      landmarks: ["metro"],
      budgetSignals: ["under_15k"],
    });
  });
});
