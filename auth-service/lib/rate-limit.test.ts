import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T00:00:00.000Z"));
  });

  it("allows the first N requests within the window", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("1.2.3.4", 5, 10_000)).toBe(true);
    }
  });

  it("blocks the (N+1)th request within the same window", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("5.6.7.8", 5, 10_000);
    expect(checkRateLimit("5.6.7.8", 5, 10_000)).toBe(false);
  });

  it("resets after the window elapses", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("9.9.9.9", 5, 10_000);
    expect(checkRateLimit("9.9.9.9", 5, 10_000)).toBe(false);
    vi.advanceTimersByTime(10_001);
    expect(checkRateLimit("9.9.9.9", 5, 10_000)).toBe(true);
  });

  it("tracks different keys independently", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("aaa", 5, 10_000);
    expect(checkRateLimit("bbb", 5, 10_000)).toBe(true);
  });
});
