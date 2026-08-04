import { describe, expect, it } from "vitest";
import { computeCostUsd, creditsFromCostUsd, usdFromCredits } from "./pricing";

describe("computeCostUsd", () => {
  it("prices a known model from prompt+completion tokens", () => {
    const cost = computeCostUsd("gemini-2.5-flash-lite", 1000, 1000);
    expect(cost).toBeCloseTo(0.0001 + 0.0004, 6);
  });

  it("strips the vertex/ provider prefix before lookup", () => {
    const withPrefix = computeCostUsd("vertex/gemini-2.5-flash", 1000, 1000);
    const withoutPrefix = computeCostUsd("gemini-2.5-flash", 1000, 1000);
    expect(withPrefix).toBe(withoutPrefix);
  });

  it("returns 0 for an unlisted model instead of throwing", () => {
    expect(computeCostUsd("some-future-model", 1000, 1000)).toBe(0);
  });

  it("gemini-2.5-pro costs more per token than flash-lite", () => {
    const lite = computeCostUsd("gemini-2.5-flash-lite", 1000, 1000);
    const pro = computeCostUsd("gemini-2.5-pro", 1000, 1000);
    expect(pro).toBeGreaterThan(lite);
  });
});

describe("credit <-> usd conversion", () => {
  it("round-trips through creditsFromCostUsd and usdFromCredits", () => {
    const credits = creditsFromCostUsd(0.05);
    expect(usdFromCredits(credits)).toBeCloseTo(0.05, 9);
  });
});
