import { describe, expect, it } from "vitest";
import {
  ORCHESTRATOR_TOOL_ALLOWLIST,
  assertOrchestratorProfile,
  clampOrchestratorTtl,
} from "./orchestrator-tools";

describe("orchestrator-tools", () => {
  it("allowlist is non-empty and excludes create_proposal", () => {
    expect(ORCHESTRATOR_TOOL_ALLOWLIST.length).toBeGreaterThan(0);
    expect(ORCHESTRATOR_TOOL_ALLOWLIST).not.toContain("create_proposal");
    expect(ORCHESTRATOR_TOOL_ALLOWLIST).toContain("list_proposals");
  });

  it("rejects other profiles", () => {
    expect(() => assertOrchestratorProfile("leads")).toThrow(/forbidden_profile/);
  });

  it("clamps ttl", () => {
    expect(clampOrchestratorTtl(99999)).toBe(3600);
    expect(clampOrchestratorTtl(undefined)).toBe(900);
  });
});
