import { afterEach, describe, expect, it, vi } from "vitest";
import { chunkIntervalMs, forEachChunkPaced } from "./pace";

describe("chunkIntervalMs", () => {
  it("computes the wall-clock delay so chunkSize/interval matches the target rate", () => {
    expect(chunkIntervalMs(30, 30)).toBe(60_000);
    expect(chunkIntervalMs(32, 30)).toBeCloseTo(64_000);
  });

  it("returns 0 when rate limiting is disabled", () => {
    expect(chunkIntervalMs(10, 0)).toBe(0);
  });
});

describe("forEachChunkPaced", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("processes items in chunkSize groups, in order", async () => {
    const seen: number[][] = [];
    await forEachChunkPaced([1, 2, 3, 4, 5], 2, 0, async (chunk) => {
      seen.push(chunk);
    });
    expect(seen).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("sleeps between chunks to respect the rate, but not after the last chunk", async () => {
    vi.useFakeTimers();
    const seen: number[] = [];

    const run = forEachChunkPaced([1, 2, 3], 1, 60, async (chunk) => {
      seen.push(chunk[0]);
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([1]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([1, 2]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([1, 2, 3]);

    await run;
  });
});
