import { describe, expect, it } from "vitest";
import {
  PERFORMANCE_TOOL_ALLOWLIST,
  clampPerformanceTtl,
  assertPerformanceProfile,
} from "./performance-tools";

it("includes get_campaign_performance and create_proposal", () => {
  expect(PERFORMANCE_TOOL_ALLOWLIST).toContain("get_campaign_performance");
  expect(PERFORMANCE_TOOL_ALLOWLIST).toContain("create_proposal");
});

it("clamps ttl", () => {
  expect(clampPerformanceTtl(99999)).toBe(3600);
  expect(clampPerformanceTtl(undefined)).toBe(900);
});

it("assertPerformanceProfile rejects others", () => {
  expect(() => assertPerformanceProfile("leads")).toThrow("forbidden_profile");
});
