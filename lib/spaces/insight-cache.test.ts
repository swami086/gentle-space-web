import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_CACHE_ENTRIES,
  cacheKey,
  clearInsightCache,
  getCached,
  setCached,
  singleFlight,
} from "./insight-cache";

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
    const key = cacheKey("insight", ["listing-1", "sig"]);
    setCached(key, TWENTY_FOUR_HOURS_MS, { summary: "Cached", highlights: [] });

    expect(getCached(key)).not.toBeNull();

    vi.advanceTimersByTime(TWENTY_FOUR_HOURS_MS);
    expect(getCached(key)).toBeNull();
  });

  it("prunes expired entries on write", () => {
    const expired = cacheKey("nearby", ["expired"]);
    const fresh = cacheKey("nearby", ["fresh"]);
    setCached(expired, 1000, ["old"]);
    vi.advanceTimersByTime(1001);

    setCached(fresh, THIRTY_DAYS_MS, ["new"]);
    expect(getCached(expired)).toBeNull();
    expect(getCached(fresh)).toEqual(["new"]);
  });

  it("refreshes LRU recency on read", () => {
    const first = cacheKey("nearby", ["a"]);
    const second = cacheKey("nearby", ["b"]);
    const third = cacheKey("nearby", ["c"]);
    setCached(first, THIRTY_DAYS_MS, 1);
    setCached(second, THIRTY_DAYS_MS, 2);
    setCached(third, THIRTY_DAYS_MS, 3);

    expect(getCached(first)).toBe(1);

    for (let i = 0; i < MAX_CACHE_ENTRIES - 3; i++) {
      setCached(cacheKey("nearby", [`fill-${i}`]), THIRTY_DAYS_MS, i);
    }
    setCached(cacheKey("nearby", ["overflow"]), THIRTY_DAYS_MS, "overflow");

    expect(getCached(first)).toBe(1);
    expect(getCached(second)).toBeNull();
    expect(getCached(third)).toBe(3);
  });

  it("evicts oldest entries when max size is exceeded", () => {
    for (let i = 0; i < MAX_CACHE_ENTRIES; i++) {
      setCached(cacheKey("nearby", [`slot-${i}`]), THIRTY_DAYS_MS, i);
    }

    setCached(cacheKey("nearby", ["overflow"]), THIRTY_DAYS_MS, "overflow");
    expect(getCached(cacheKey("nearby", ["slot-0"]))).toBeNull();
    expect(getCached(cacheKey("nearby", ["overflow"]))).toBe("overflow");
  });

  it("builds stable keys from namespace and parts", () => {
    expect(cacheKey("nearby", ["a", "b"])).toBe("nearby:a|b");
  });

  it("clearInsightCache removes resolved and in-flight entries", async () => {
    const key = cacheKey("nearby", ["listing-1"]);
    setCached(key, THIRTY_DAYS_MS, []);
    let resolve!: () => void;
    const pending = singleFlight("flight", () => new Promise<void>((r) => { resolve = r; }));

    clearInsightCache();
    expect(getCached(key)).toBeNull();

    resolve();
    await pending;
  });

  it("deduplicates concurrent producers for the same key", async () => {
    const producer = vi.fn(async () => "value");
    const [a, b] = await Promise.all([
      singleFlight("same", producer),
      singleFlight("same", producer),
    ]);

    expect(a).toBe("value");
    expect(b).toBe("value");
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it("removes rejected in-flight promises so retries can run", async () => {
    const producer = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("ok");

    await expect(singleFlight("retry", producer)).rejects.toThrow("fail");
    await expect(singleFlight("retry", producer)).resolves.toBe("ok");
    expect(producer).toHaveBeenCalledTimes(2);
  });
});
