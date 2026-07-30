import { describe, expect, it } from "vitest";
import { emptyQueryEntities } from "./types";
import { parseExtractedEntities, parseExtractedEntitiesBatchJson } from "./extract";

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

describe("parseExtractedEntitiesBatchJson", () => {
  it("maps each result to its input item by position", () => {
    const raw = JSON.stringify({
      results: [
        { areas: ["Koramangala"], amenities: [], deskTypes: [], landmarks: [], budgetSignals: [] },
        { areas: ["Indiranagar"], amenities: ["WiFi"], deskTypes: [], landmarks: [], budgetSignals: [] },
      ],
    });

    expect(parseExtractedEntitiesBatchJson(raw, 2)).toEqual([
      { areas: ["koramangala"], amenities: [], deskTypes: [], landmarks: [], budgetSignals: [] },
      { areas: ["indiranagar"], amenities: ["wifi"], deskTypes: [], landmarks: [], budgetSignals: [] },
    ]);
  });

  it("pads missing entries with empty entities instead of misaligning the array", () => {
    const raw = JSON.stringify({ results: [{ areas: ["Koramangala"] }] });

    expect(parseExtractedEntitiesBatchJson(raw, 3)).toEqual([
      { ...emptyQueryEntities(), areas: ["koramangala"] },
      emptyQueryEntities(),
      emptyQueryEntities(),
    ]);
  });

  it("returns all-empty entities for malformed JSON or a missing results key", () => {
    expect(parseExtractedEntitiesBatchJson("not json", 2)).toEqual([
      emptyQueryEntities(),
      emptyQueryEntities(),
    ]);
    expect(parseExtractedEntitiesBatchJson(JSON.stringify({}), 1)).toEqual([emptyQueryEntities()]);
  });
});
