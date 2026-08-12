import { describe, it, expect } from "vitest";
import {
  ATTRIBUTION_MAX_LAG_SECONDS,
  assertFreshEnoughToSpend,
  freshness,
  StaleAttributionError,
} from "./freshness";

describe("freshness", () => {
  it("reports lag as the gap between the watermark and the computation", () => {
    const f = freshness(new Date("2026-08-12T10:05:00Z"), new Date("2026-08-12T10:00:00Z"));
    expect(f.cdcLagSeconds).toBe(300);
    expect(f.isStale).toBe(false);
    expect(f.computedAt).toBe("2026-08-12T10:05:00.000Z");
    expect(f.sourceWatermark).toBe("2026-08-12T10:00:00.000Z");
  });

  it("is stale once lag exceeds the threshold", () => {
    expect(ATTRIBUTION_MAX_LAG_SECONDS).toBe(900);
    const f = freshness(new Date("2026-08-12T10:16:00Z"), new Date("2026-08-12T10:00:00Z"));
    expect(f.cdcLagSeconds).toBe(960);
    expect(f.isStale).toBe(true);
  });

  it("clamps a watermark ahead of the computation to zero rather than reporting negative lag", () => {
    const f = freshness(new Date("2026-08-12T10:00:00Z"), new Date("2026-08-12T10:00:05Z"));
    expect(f.cdcLagSeconds).toBe(0);
  });
});

describe("assertFreshEnoughToSpend", () => {
  it("passes fresh data through", () => {
    const f = freshness(new Date("2026-08-12T10:01:00Z"), new Date("2026-08-12T10:00:00Z"));
    expect(() => assertFreshEnoughToSpend(f)).not.toThrow();
  });

  it("refuses stale data, and says refusing is correct", () => {
    const f = freshness(new Date("2026-08-12T11:00:00Z"), new Date("2026-08-12T10:00:00Z"));
    expect(() => assertFreshEnoughToSpend(f)).toThrow(StaleAttributionError);
    expect(() => assertFreshEnoughToSpend(f)).toThrow(/refusing is correct behaviour/);
  });
});
