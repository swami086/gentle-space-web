import { describe, expect, it } from "vitest";
import { allowlistFor, clampTtlFor, isAgentProfile } from "./profiles";
import { LEADS_TOOL_ALLOWLIST } from "./leads-tools";

describe("profiles", () => {
  it("accepts known profiles only", () => {
    expect(isAgentProfile("leads")).toBe(true);
    expect(isAgentProfile("orchestrator")).toBe(true);
    expect(isAgentProfile("campaign")).toBe(false);
  });

  it("leads allowlist matches LEADS_TOOL_ALLOWLIST", () => {
    expect([...allowlistFor("leads")]).toEqual([...LEADS_TOOL_ALLOWLIST]);
  });

  it("orchestrator allowlist does not include create_proposal", () => {
    expect(allowlistFor("orchestrator")).not.toContain("create_proposal");
  });

  it("clamps ttl per profile", () => {
    expect(clampTtlFor("leads", 99999)).toBeLessThanOrEqual(3600);
    expect(clampTtlFor("orchestrator", undefined)).toBeGreaterThan(0);
  });
});
