import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_PROFILE,
  CAMPAIGN_TOOL_ALLOWLIST,
  CAMPAIGN_TOKEN_TTL_DEFAULT,
  CAMPAIGN_TOKEN_TTL_MAX,
  clampCampaignTtl,
  assertCampaignProfile,
} from "./campaign-tools";

describe("campaign-tools", () => {
  it("exports profile campaign", () => {
    expect(CAMPAIGN_PROFILE).toBe("campaign");
  });

  it("includes get_campaign_performance, create_proposal, and corridor tools", () => {
    expect(CAMPAIGN_TOOL_ALLOWLIST).toEqual(
      expect.arrayContaining([
        "get_campaign_performance",
        "get_context_pack",
        "list_proposals",
        "graph_query",
        "create_proposal",
        "search_spaces",
        "get_space",
      ]),
    );
    expect(CAMPAIGN_TOOL_ALLOWLIST.length).toBe(7);
  });

  it("clamps ttl", () => {
    expect(clampCampaignTtl(undefined)).toBe(CAMPAIGN_TOKEN_TTL_DEFAULT);
    expect(clampCampaignTtl(60)).toBe(60);
    expect(clampCampaignTtl(99999)).toBe(CAMPAIGN_TOKEN_TTL_MAX);
    expect(clampCampaignTtl(0)).toBe(CAMPAIGN_TOKEN_TTL_DEFAULT);
    expect(clampCampaignTtl(-1)).toBe(CAMPAIGN_TOKEN_TTL_DEFAULT);
  });

  it("assertCampaignProfile rejects others", () => {
    expect(() => assertCampaignProfile("campaign")).not.toThrow();
    expect(() => assertCampaignProfile("leads")).toThrow(/forbidden_profile/);
  });
});
