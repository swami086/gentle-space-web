import { describe, expect, it } from "vitest";
import {
  GOOGLE_ADS_MCP_READ_TOOLS,
  GOOGLE_ADS_MCP_WRITE_TOOLS,
  assertGoogleAdsReadOnlyTool,
} from "./google-ads-read-tools";

describe("google-ads-read-tools", () => {
  it("read set has exactly the three MCP read tools", () => {
    expect(GOOGLE_ADS_MCP_READ_TOOLS).toEqual([
      "list_campaign_performance",
      "search_terms_report",
      "list_accessible_customers",
    ]);
    expect(GOOGLE_ADS_MCP_READ_TOOLS.length).toBe(3);
  });

  it("write set includes propose_change and pause_campaign", () => {
    expect(GOOGLE_ADS_MCP_WRITE_TOOLS).toContain("propose_change");
    expect(GOOGLE_ADS_MCP_WRITE_TOOLS).toContain("pause_campaign");
    expect(GOOGLE_ADS_MCP_WRITE_TOOLS).toEqual([
      "create_campaign",
      "pause_campaign",
      "update_campaign_budget",
      "add_negative_keyword",
      "propose_change",
    ]);
  });

  it("read and write sets are disjoint", () => {
    for (const name of GOOGLE_ADS_MCP_READ_TOOLS) {
      expect(GOOGLE_ADS_MCP_WRITE_TOOLS).not.toContain(name);
    }
  });

  it("assertGoogleAdsReadOnlyTool rejects write tools", () => {
    expect(() => assertGoogleAdsReadOnlyTool("pause_campaign")).toThrow();
    expect(() => assertGoogleAdsReadOnlyTool("propose_change")).toThrow();
    expect(() => assertGoogleAdsReadOnlyTool("create_campaign")).toThrow();
  });

  it("assertGoogleAdsReadOnlyTool accepts read tools", () => {
    for (const name of GOOGLE_ADS_MCP_READ_TOOLS) {
      expect(() => assertGoogleAdsReadOnlyTool(name)).not.toThrow();
    }
  });
});
