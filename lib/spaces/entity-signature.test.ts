import { describe, expect, it } from "vitest";
import { emptyQueryEntities } from "../graph/types";
import { canonicalizeQueryEntities, entitySignature } from "./entity-signature";

describe("canonicalizeQueryEntities", () => {
  it("trims, lowercases, dedupes, and lexicographically sorts each field", () => {
    const raw = {
      areas: [" Bellandur ", "bellandur", "Koramangala"],
      amenities: [" Gym ", "WiFi", "wifi"],
      deskTypes: [" Hot Desk ", "hot desk"],
      landmarks: [],
      budgetSignals: [" Under 20k ", "under 20k"],
    };

    expect(canonicalizeQueryEntities(raw)).toEqual({
      areas: ["bellandur", "koramangala"],
      amenities: ["gym", "wifi"],
      deskTypes: ["hot desk"],
      landmarks: [],
      budgetSignals: ["under 20k"],
    });
  });
});

describe("entitySignature", () => {
  it("is deterministic for entity order permutations", () => {
    const a = {
      ...emptyQueryEntities(),
      amenities: ["coffee", "gym"],
    };
    const b = {
      ...emptyQueryEntities(),
      amenities: ["gym", "coffee"],
    };

    expect(entitySignature(a)).toBe(entitySignature(b));
  });

  it("uses canonical JSON with fixed field order", () => {
    const sig = entitySignature({
      ...emptyQueryEntities(),
      areas: ["bellandur"],
    });

    expect(sig).toBe(
      JSON.stringify({
        areas: ["bellandur"],
        amenities: [],
        deskTypes: [],
        landmarks: [],
        budgetSignals: [],
      }),
    );
  });

  it("differs when entity values differ", () => {
    const base = emptyQueryEntities();
    expect(entitySignature({ ...base, areas: ["a"] })).not.toBe(
      entitySignature({ ...base, areas: ["b"] }),
    );
  });
});
