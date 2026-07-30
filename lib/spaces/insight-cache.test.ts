import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheKey, clearInsightCache, getCached, setCached } from "./insight-cache";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  clearInsightCache();
});

afterEach(() => {
  clearInsightCache();
  vi.useRealTimers();
});

describe("insight-cache", () => {
  it("returns null for a key that was never set", () => {
    expect(getCached("missing:key")).toBeNull();
  });

  it("returns a value set within its TTL", () => {
    const key = cacheKey("nearby", ["listing-1", "cafe"]);
    const value = [{ category: "cafe", label: "Cafes", places: [] }];
    setCached(key, THIRTY_DAYS_MS, value);

    expect(getCached<typeof value>(key)).toEqual(value);
  });

  it("returns null after the TTL has elapsed", () => {
    const key = cacheKey("insight", ["listing-1", "sig", "1"]);
    setCached(key, TWENTY_FOUR_HOURS_MS, { summary: "Cached", highlights: [] });

    expect(getCached(key)).not.toBeNull();

    vi.advanceTimersByTime(TWENTY_FOUR_HOURS_MS);
    expect(getCached(key)).toBeNull();
  });

  it("builds stable keys from namespace and parts", () => {
    expect(cacheKey("nearby", ["a", "b"])).toBe("nearby:a|b");
  });

  it("clearInsightCache removes all entries", () => {
    const key = cacheKey("nearby", ["listing-1"]);
    setCached(key, THIRTY_DAYS_MS, []);
    clearInsightCache();
    expect(getCached(key)).toBeNull();
  });
});
