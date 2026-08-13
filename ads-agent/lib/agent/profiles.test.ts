import { describe, expect, it } from "vitest";
import { allowlistFor, clampTtlFor, isAgentProfile } from "./profiles";
import { LEADS_TOOL_ALLOWLIST } from "./leads-tools";
import { PERFORMANCE_TOOL_ALLOWLIST } from "./performance-tools";
import { CAMPAIGN_TOOL_ALLOWLIST } from "./campaign-tools";

describe("profiles", () => {
  it("accepts known profiles only", () => {
    expect(isAgentProfile("leads")).toBe(true);
    expect(isAgentProfile("orchestrator")).toBe(true);
    expect(isAgentProfile("performance")).toBe(true);
    expect(isAgentProfile("campaign")).toBe(true);
    expect(isAgentProfile("research")).toBe(false);
  });

  it("leads allowlist matches LEADS_TOOL_ALLOWLIST", () => {
    expect([...allowlistFor("leads")]).toEqual([...LEADS_TOOL_ALLOWLIST]);
  });

  it("orchestrator allowlist does not include create_proposal", () => {
    expect(allowlistFor("orchestrator")).not.toContain("create_proposal");
  });

  it("performance allowlist matches PERFORMANCE_TOOL_ALLOWLIST", () => {
    expect([...allowlistFor("performance")]).toEqual([...PERFORMANCE_TOOL_ALLOWLIST]);
    expect(allowlistFor("performance")).toContain("get_campaign_performance");
    expect(allowlistFor("performance")).toContain("create_proposal");
  });

  it("campaign allowlist matches CAMPAIGN_TOOL_ALLOWLIST", () => {
    expect([...allowlistFor("campaign")]).toEqual([...CAMPAIGN_TOOL_ALLOWLIST]);
    expect(allowlistFor("campaign")).toContain("get_campaign_performance");
    expect(allowlistFor("campaign")).toContain("search_spaces");
  });

  it("clamps ttl per profile", () => {
    expect(clampTtlFor("leads", 99999)).toBeLessThanOrEqual(3600);
    expect(clampTtlFor("orchestrator", undefined)).toBeGreaterThan(0);
    expect(clampTtlFor("performance", undefined)).toBe(900);
    expect(clampTtlFor("campaign", 99999)).toBeLessThanOrEqual(3600);
  });
});
