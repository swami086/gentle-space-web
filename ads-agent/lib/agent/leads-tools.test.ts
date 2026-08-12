import { describe, expect, it } from "vitest";
import {
  LEADS_PROFILE,
  LEADS_TOOL_ALLOWLIST,
  clampLeadsTtl,
  assertLeadsProfile,
  LEADS_TOKEN_TTL_DEFAULT,
  LEADS_TOKEN_TTL_MAX,
} from "./leads-tools";

describe("leads-tools", () => {
  it("exports profile leads", () => {
    expect(LEADS_PROFILE).toBe("leads");
  });

  it("allowlist includes enquiry + proposal tools and omits campaign performance", () => {
    expect(LEADS_TOOL_ALLOWLIST).toEqual(
      expect.arrayContaining([
        "list_enquiries",
        "get_enquiry",
        "get_context_pack",
        "search_spaces",
        "get_space",
        "list_proposals",
        "graph_query",
        "create_proposal",
      ]),
    );
    expect(LEADS_TOOL_ALLOWLIST).not.toContain("get_campaign_performance");
    expect(LEADS_TOOL_ALLOWLIST.length).toBe(8);
  });

  it("clamps ttl", () => {
    expect(clampLeadsTtl(undefined)).toBe(LEADS_TOKEN_TTL_DEFAULT);
    expect(clampLeadsTtl(60)).toBe(60);
    expect(clampLeadsTtl(99999)).toBe(LEADS_TOKEN_TTL_MAX);
    expect(clampLeadsTtl(0)).toBe(LEADS_TOKEN_TTL_DEFAULT);
    expect(clampLeadsTtl(-1)).toBe(LEADS_TOKEN_TTL_DEFAULT);
  });

  it("assertLeadsProfile rejects others", () => {
    expect(() => assertLeadsProfile("leads")).not.toThrow();
    expect(() => assertLeadsProfile("campaign")).toThrow(/forbidden_profile/);
  });
});
