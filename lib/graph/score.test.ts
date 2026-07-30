import { describe, expect, it } from "vitest";
import { maxPossibleOverlap, overlapFromMatched, mergeVectorAndGraphScores } from "./score";
import type { VectorGraphCandidate } from "./types";
import { emptyQueryEntities } from "./types";

describe("maxPossibleOverlap", () => {
  it("sums weighted entity counts", () => {
    expect(
      maxPossibleOverlap({
        areas: ["a"],
        amenities: ["wifi", "ac"],
        deskTypes: ["cabin"],
        landmarks: ["metro"],
        budgetSignals: ["under_15k"],
      }),
    ).toBe(3 + 1 + 1 + 3 + 2 + 2); // 12
  });
});

describe("mergeVectorAndGraphScores", () => {
  it("boosts listing with higher graph overlap", () => {
    const empty = emptyQueryEntities();
    const candidates: VectorGraphCandidate[] = [
      {
        id: "low-vec-high-graph",
        vectorSimilarity: 0.7,
        graphOverlap: 8,
        matchedEntities: empty,
      },
      {
        id: "high-vec-low-graph",
        vectorSimilarity: 0.85,
        graphOverlap: 0,
        matchedEntities: empty,
      },
    ];
    const ranked = mergeVectorAndGraphScores(candidates, 0.35, 10);
    expect(ranked[0].id).toBe("low-vec-high-graph");
    // 0.7 + 0.35*(8/10)=0.98 > 0.85 + 0
  });

  it("falls back to vector order when maxPossible is 0", () => {
    const empty = emptyQueryEntities();
    const ranked = mergeVectorAndGraphScores(
      [
        { id: "a", vectorSimilarity: 0.5, graphOverlap: 0, matchedEntities: empty },
        { id: "b", vectorSimilarity: 0.9, graphOverlap: 0, matchedEntities: empty },
      ],
      0.35,
      0,
    );
    expect(ranked.map((c) => c.id)).toEqual(["b", "a"]);
  });
});
