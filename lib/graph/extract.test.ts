import { describe, expect, it } from "vitest";
import { emptyQueryEntities } from "./types";
import { parseExtractedEntities } from "./extract";

describe("parseExtractedEntities", () => {
  it("returns empty entities for invalid input", () => {
    expect(parseExtractedEntities(null)).toEqual(emptyQueryEntities());
    expect(parseExtractedEntities("nope")).toEqual(emptyQueryEntities());
    expect(parseExtractedEntities({ areas: "indiranagar" })).toEqual(emptyQueryEntities());
  });

  it("fills missing top-level keys with empty arrays", () => {
    expect(parseExtractedEntities({ areas: [" Indiranagar "] })).toEqual({
      areas: ["indiranagar"],
      amenities: [],
      deskTypes: [],
      landmarks: [],
      budgetSignals: [],
    });
  });

  it("filters non-strings and normalizes valid entity arrays", () => {
    expect(
      parseExtractedEntities({
        areas: [" Indiranagar ", 42, "indiranagar"],
        amenities: [" WiFi ", "", { name: "gym" }],
        deskTypes: [" Private Cabin ", "private  cabin"],
        landmarks: [" Metro Station "],
        budgetSignals: [" Under 20k ", null],
      }),
    ).toEqual({
      areas: ["indiranagar"],
      amenities: ["wifi"],
      deskTypes: ["private cabin"],
      landmarks: ["metro station"],
      budgetSignals: ["under 20k"],
    });
  });
});
