import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, resetRateLimits, SESSION_LIMIT_PER_MINUTE } from "./rate-limit";

beforeEach(() => resetRateLimits());

describe("checkRateLimit", () => {
  it("allows traffic inside the session limit", () => {
    for (let i = 0; i < SESSION_LIMIT_PER_MINUTE; i += 1) {
      expect(checkRateLimit("key-1", "sess-1", 1_000)).toBe(true);
    }
  });

  it("blocks the session once over the limit, in the same window", () => {
    for (let i = 0; i < SESSION_LIMIT_PER_MINUTE; i += 1) checkRateLimit("key-1", "sess-1", 1_000);
    expect(checkRateLimit("key-1", "sess-1", 1_000)).toBe(false);
  });

  it("does not let one session's abuse block another", () => {
    for (let i = 0; i <= SESSION_LIMIT_PER_MINUTE; i += 1) checkRateLimit("key-1", "sess-1", 1_000);
    expect(checkRateLimit("key-1", "sess-2", 1_000)).toBe(true);
  });

  it("resets on the next window", () => {
    for (let i = 0; i <= SESSION_LIMIT_PER_MINUTE; i += 1) checkRateLimit("key-1", "sess-1", 1_000);
    expect(checkRateLimit("key-1", "sess-1", 1_000 + 60_001)).toBe(true);
  });
});
