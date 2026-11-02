import { beforeEach, describe, expect, it, vi } from "vitest";

const { callGoogleAdsTool } = vi.hoisted(() => ({ callGoogleAdsTool: vi.fn() }));
vi.mock("../bifrost/google-ads-mcp-client", () => ({ callGoogleAdsTool }));

import {
  addGoogleNegativeKeyword,
  createFullGoogleCampaign,
  createGoogleShareCampaign,
  fetchGoogleAdsPerformance,
  fetchGoogleSearchTerms,
  enableGoogleShareCampaign,
  pauseGoogleCampaign,
  updateGoogleCampaignBudget,
  updateGoogleShareBudget,
} from "./google-ads";

beforeEach(() => {
  callGoogleAdsTool.mockReset();
});

describe("fetchGoogleAdsPerformance", () => {
  it("calls list_campaign_performance with no args and returns the rows", async () => {
    const rows = [{ externalCampaignId: "111", spend: 40.5, clicks: 12, impressions: 900, conversions: 1 }];
    callGoogleAdsTool.mockResolvedValue(rows);
    const result = await fetchGoogleAdsPerformance();
    expect(result).toEqual(rows);
    expect(callGoogleAdsTool).toHaveBeenCalledWith("list_campaign_performance", {});
  });
});

describe("fetchGoogleSearchTerms", () => {
  it("calls search_terms_report with no args and returns the rows", async () => {
    const rows = [{ externalCampaignId: "111", searchTerm: "office space for rent", clicks: 4, conversions: 0 }];
    callGoogleAdsTool.mockResolvedValue(rows);
    const result = await fetchGoogleSearchTerms();
    expect(result).toEqual(rows);
    expect(callGoogleAdsTool).toHaveBeenCalledWith("search_terms_report", {});
  });
});

describe("createFullGoogleCampaign", () => {
  it("calls create_campaign with the input and returns the resource name from the result", async () => {
    const input = {
      name: "Whitefield Search",
      dailyBudgetInr: 500,
      geoTargetConstant: "geoTargetConstants/2356",
      languageConstant: "languageConstants/1000",
      adGroupName: "Whitefield Office Space",
      keywords: [{ text: "office space whitefield", matchType: "phrase" as const }],
      negativeKeywords: ["residential"],
      headlines: ["Office Space in Whitefield"],
      descriptions: ["Skip the broker games."],
      finalUrl: "https://www.gentlespacesolutions.com/spaces",
    };
    callGoogleAdsTool.mockResolvedValue({ resourceName: "customers/1234567890/campaigns/999" });
    const resourceName = await createFullGoogleCampaign(input);
    expect(resourceName).toBe("customers/1234567890/campaigns/999");
    expect(callGoogleAdsTool).toHaveBeenCalledWith("create_campaign", input, { surface: "write" });
  });
});

describe("createGoogleShareCampaign", () => {
  it("calls create_share_campaign with the input and returns the campaign id from the result", async () => {
    const input = {
      name: "Whitefield Share",
      totalBudgetMinor: 50_000,
      geoTargetConstant: "geoTargetConstants/2356",
      languageConstant: "languageConstants/1000",
      adGroupName: "Whitefield Office Space",
      keywords: [{ text: "office space whitefield", matchType: "phrase" as const }],
      negativeKeywords: ["residential"],
      headlines: ["Office Space in Whitefield"],
      descriptions: ["Skip the broker games."],
      finalUrl: "https://www.gentlespacesolutions.com/spaces",
    };
    callGoogleAdsTool.mockResolvedValue({ campaignId: 999 });
    const campaignId = await createGoogleShareCampaign(input);
    expect(campaignId).toBe(999);
    expect(callGoogleAdsTool).toHaveBeenCalledWith("create_share_campaign", input, { surface: "write" });
  });
});

describe("updateGoogleShareBudget", () => {
  it("calls update_share_budget with the campaign resource name and total budget minor units", async () => {
    callGoogleAdsTool.mockResolvedValue({ ok: true });
    await updateGoogleShareBudget("customers/1234567890/campaigns/999", 75_000);
    expect(callGoogleAdsTool).toHaveBeenCalledWith(
      "update_share_budget",
      { campaignResourceName: "customers/1234567890/campaigns/999", totalBudgetMinor: 75_000 },
      { surface: "write" },
    );
  });
});

describe("pauseGoogleCampaign", () => {
  it("calls pause_campaign with the campaign resource name", async () => {
    callGoogleAdsTool.mockResolvedValue({ ok: true });
    await pauseGoogleCampaign("customers/1234567890/campaigns/999");
    expect(callGoogleAdsTool).toHaveBeenCalledWith("pause_campaign", {
      campaignResourceName: "customers/1234567890/campaigns/999",
    }, { surface: "write" });
  });
});

describe("enableGoogleShareCampaign", () => {
  it("calls enable_share_campaign with the campaign resource name", async () => {
    callGoogleAdsTool.mockResolvedValue({ ok: true });
    await enableGoogleShareCampaign("customers/1234567890/campaigns/999");
    expect(callGoogleAdsTool).toHaveBeenCalledWith(
      "enable_share_campaign",
      { campaignResourceName: "customers/1234567890/campaigns/999" },
      { surface: "write" },
    );
  });
});

describe("updateGoogleCampaignBudget", () => {
  it("calls update_campaign_budget with the campaign resource name and new budget", async () => {
    callGoogleAdsTool.mockResolvedValue({ ok: true });
    await updateGoogleCampaignBudget("customers/1234567890/campaigns/999", 750);
    expect(callGoogleAdsTool).toHaveBeenCalledWith("update_campaign_budget", {
      campaignResourceName: "customers/1234567890/campaigns/999",
      dailyBudgetInr: 750,
    }, { surface: "write" });
  });
});

describe("addGoogleNegativeKeyword", () => {
  it("calls add_negative_keyword with the campaign resource name and keyword text", async () => {
    callGoogleAdsTool.mockResolvedValue({ ok: true });
    await addGoogleNegativeKeyword("customers/1234567890/campaigns/999", "residential");
    expect(callGoogleAdsTool).toHaveBeenCalledWith("add_negative_keyword", {
      campaignResourceName: "customers/1234567890/campaigns/999",
      keywordText: "residential",
    }, { surface: "write" });
  });
});
