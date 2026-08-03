import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const mutateResourcesMock = vi.fn();
const CustomerMock = vi.fn(() => ({ query: queryMock, mutateResources: mutateResourcesMock }));

vi.mock("google-ads-api", async () => {
  const actual = await vi.importActual<typeof import("google-ads-api")>("google-ads-api");
  return {
    ...actual,
    GoogleAdsApi: class MockGoogleAdsApi {
      Customer = CustomerMock;
    },
  };
});

beforeEach(() => {
  vi.resetModules();
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
  process.env.GOOGLE_ADS_CLIENT_ID = "client-id";
  process.env.GOOGLE_ADS_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_ADS_REFRESH_TOKEN = "refresh-token";
  process.env.GOOGLE_ADS_CUSTOMER_ID = "1234567890";
  queryMock.mockReset();
  mutateResourcesMock.mockReset();
  CustomerMock.mockClear();
});

describe("fetchGoogleAdsPerformance", () => {
  it("maps GAQL rows to performance rows", async () => {
    queryMock.mockResolvedValue([
      {
        campaign: { id: "111" },
        metrics: { cost_micros: "40500000", clicks: "12", impressions: "900", all_conversions: "1" },
      },
    ]);
    const { fetchGoogleAdsPerformance } = await import("./google-ads");
    const result = await fetchGoogleAdsPerformance();
    expect(result).toEqual([
      { externalCampaignId: "111", spend: 40.5, clicks: 12, impressions: 900, conversions: 1 },
    ]);
  });
});

describe("fetchGoogleSearchTerms", () => {
  it("maps search term rows", async () => {
    queryMock.mockResolvedValue([
      {
        campaign: { id: "111" },
        search_term_view: { search_term: "office space for rent" },
        metrics: { clicks: "4", conversions: "0" },
      },
    ]);
    const { fetchGoogleSearchTerms } = await import("./google-ads");
    const result = await fetchGoogleSearchTerms();
    expect(result).toEqual([
      { externalCampaignId: "111", searchTerm: "office space for rent", clicks: 4, conversions: 0 },
    ]);
  });
});

describe("createFullGoogleCampaign", () => {
  it("creates budget, campaign, ad group, keywords, negatives, and an RSA atomically", async () => {
    mutateResourcesMock.mockResolvedValue({
      mutate_operation_responses: [
        { campaign_budget_result: { resource_name: "customers/1234567890/campaignBudgets/-1" } },
        { campaign_result: { resource_name: "customers/1234567890/campaigns/999" } },
        { ad_group_result: { resource_name: "customers/1234567890/adGroups/-3" } },
        { ad_group_criterion_result: { resource_name: "customers/1234567890/adGroupCriteria/-3~-4" } },
        { ad_group_criterion_result: { resource_name: "customers/1234567890/adGroupCriteria/-3~-5" } },
        { ad_group_ad_result: { resource_name: "customers/1234567890/adGroupAds/-3~-6" } },
      ],
    });
    const { createFullGoogleCampaign } = await import("./google-ads");
    const resourceName = await createFullGoogleCampaign({
      name: "Whitefield Search",
      dailyBudgetInr: 500,
      adGroupName: "Whitefield Office Space",
      keywords: [{ text: "office space whitefield", matchType: "phrase" }],
      negativeKeywords: ["residential"],
      headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
      descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
      finalUrl: "https://www.gentlespacesolutions.com/spaces",
    });

    expect(resourceName).toBe("customers/1234567890/campaigns/999");
    const operations = mutateResourcesMock.mock.calls[0][0];
    expect(operations.map((op: { entity: string }) => op.entity)).toEqual([
      "campaign_budget",
      "campaign",
      "ad_group",
      "ad_group_criterion",
      "ad_group_criterion",
      "ad_group_ad",
    ]);
    expect(operations[1].resource.resource_name).toBe("customers/1234567890/campaigns/-2");
    expect(operations[2].resource).toMatchObject({
      name: "Whitefield Office Space",
      campaign: "customers/1234567890/campaigns/-2",
    });
    expect(operations[3].resource).toMatchObject({
      ad_group: "customers/1234567890/adGroups/-3",
      keyword: { text: "office space whitefield", match_type: 3 },
    });
    expect(operations[4].resource).toMatchObject({
      ad_group: "customers/1234567890/adGroups/-3",
      negative: true,
      keyword: { text: "residential" },
    });
    expect(operations[5].resource.ad_group).toBe("customers/1234567890/adGroups/-3");
    expect(operations[5].resource.ad.final_urls).toEqual(["https://www.gentlespacesolutions.com/spaces"]);
    expect(operations[5].resource.ad.responsive_search_ad).toEqual({
      headlines: [
        { text: "Office Space in Whitefield" },
        { text: "Verified Listings Only" },
        { text: "Tour in 5 Days" },
      ],
      descriptions: [
        { text: "Skip the broker games." },
        { text: "AI-matched, human-verified commercial space." },
      ],
    });
  });
});

describe("pauseGoogleCampaign", () => {
  it("sends a campaign update operation with status PAUSED", async () => {
    mutateResourcesMock.mockResolvedValue({ mutate_operation_responses: [{}] });
    const { pauseGoogleCampaign } = await import("./google-ads");
    await pauseGoogleCampaign("customers/1234567890/campaigns/999");
    expect(mutateResourcesMock).toHaveBeenCalledWith([
      {
        entity: "campaign",
        operation: "update",
        resource: { resource_name: "customers/1234567890/campaigns/999", status: 3 },
      },
    ]);
  });
});

describe("updateGoogleCampaignBudget", () => {
  it("resolves campaign_budget via GAQL and mutates that budget resource", async () => {
    queryMock.mockResolvedValue([
      { campaign: { campaign_budget: "customers/1234567890/campaignBudgets/42" } },
    ]);
    mutateResourcesMock.mockResolvedValue({ mutate_operation_responses: [{}] });
    const { updateGoogleCampaignBudget } = await import("./google-ads");
    await updateGoogleCampaignBudget("customers/1234567890/campaigns/999", 750);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("campaign.resource_name = 'customers/1234567890/campaigns/999'"));
    expect(mutateResourcesMock).toHaveBeenCalledWith([
      {
        entity: "campaign_budget",
        operation: "update",
        resource: {
          resource_name: "customers/1234567890/campaignBudgets/42",
          amount_micros: 750_000_000,
        },
      },
    ]);
  });
});

describe("addGoogleNegativeKeyword", () => {
  it("creates a negative campaign criterion", async () => {
    mutateResourcesMock.mockResolvedValue({ mutate_operation_responses: [{}] });
    const { addGoogleNegativeKeyword } = await import("./google-ads");
    await addGoogleNegativeKeyword("customers/1234567890/campaigns/999", "residential");
    const operations = mutateResourcesMock.mock.calls[0][0];
    expect(operations[0]).toMatchObject({
      entity: "campaign_criterion",
      operation: "create",
      resource: {
        campaign: "customers/1234567890/campaigns/999",
        negative: true,
        keyword: { text: "residential" },
      },
    });
  });
});
