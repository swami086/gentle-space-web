import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const mutateResourcesMock = vi.fn();
const listAccessibleCustomersMock = vi.fn();
const CustomerMock = vi.fn(() => ({ query: queryMock, mutateResources: mutateResourcesMock }));

vi.mock("google-ads-api", async () => {
  const actual = await vi.importActual<typeof import("google-ads-api")>("google-ads-api");
  return {
    ...actual,
    GoogleAdsApi: class MockGoogleAdsApi {
      Customer = CustomerMock;
      listAccessibleCustomers = listAccessibleCustomersMock;
    },
  };
});

const createProposalMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/db/proposals", () => ({ createProposal: createProposalMock }));

beforeEach(() => {
  vi.resetModules();
  process.env.ADS_AGENT_ORG_ID = "org-1";
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
  process.env.GOOGLE_ADS_CLIENT_ID = "client-id";
  process.env.GOOGLE_ADS_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_ADS_REFRESH_TOKEN = "refresh-token";
  process.env.GOOGLE_ADS_CUSTOMER_ID = "1234567890";
  queryMock.mockReset();
  mutateResourcesMock.mockReset();
  listAccessibleCustomersMock.mockReset();
  CustomerMock.mockClear();
  createProposalMock.mockReset();
});

describe("fetchGoogleAdsPerformance", () => {
  it("maps GAQL rows to performance rows", async () => {
    queryMock.mockResolvedValue([
      {
        campaign: { id: "111" },
        metrics: { cost_micros: "40500000", clicks: "12", impressions: "900", all_conversions: "1" },
      },
    ]);
    const { fetchGoogleAdsPerformance } = await import("./tools");
    const result = await fetchGoogleAdsPerformance();
    expect(result).toEqual([
      { externalCampaignId: "111", spend: 40.5, clicks: 12, impressions: 900, conversions: 1 },
    ]);
    expect(String(queryMock.mock.calls[0][0])).toContain("segments.date DURING LAST_7_DAYS");
  });

  it("passes login_customer_id when GOOGLE_ADS_LOGIN_CUSTOMER_ID is set", async () => {
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "5154931609";
    queryMock.mockResolvedValue([]);
    const { fetchGoogleAdsPerformance } = await import("./tools");
    await fetchGoogleAdsPerformance();
    expect(CustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: "1234567890",
        refresh_token: "refresh-token",
        login_customer_id: "5154931609",
      }),
    );
    delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
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
    const { fetchGoogleSearchTerms } = await import("./tools");
    const result = await fetchGoogleSearchTerms();
    expect(result).toEqual([
      { externalCampaignId: "111", searchTerm: "office space for rent", clicks: 4, conversions: 0 },
    ]);
  });
});

describe("listAccessibleCustomers", () => {
  it("calls the SDK's listAccessibleCustomers with the refresh token and strips the customers/ prefix", async () => {
    listAccessibleCustomersMock.mockResolvedValue({
      resource_names: ["customers/1234567890", "customers/9876543210"],
    });
    const { listAccessibleCustomers } = await import("./tools");
    const result = await listAccessibleCustomers();
    expect(result).toEqual({ customerIds: ["1234567890", "9876543210"] });
    expect(listAccessibleCustomersMock).toHaveBeenCalledWith("refresh-token");
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
    const { createFullGoogleCampaign } = await import("./tools");
    const resourceName = await createFullGoogleCampaign({
      name: "Whitefield Search",
      dailyBudgetInr: 500,
      geoTargetConstant: "geoTargetConstants/2356",
      languageConstant: "languageConstants/1000",
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
      "campaign_criterion",
      "campaign_criterion",
      "ad_group",
      "ad_group_criterion",
      "ad_group_criterion",
      "ad_group_ad",
    ]);
    expect(operations[2]).toMatchObject({
      entity: "campaign_criterion",
      operation: "create",
      resource: {
        campaign: "customers/1234567890/campaigns/-2",
        location: { geo_target_constant: "geoTargetConstants/2356" },
      },
    });
    expect(operations[3]).toMatchObject({
      entity: "campaign_criterion",
      operation: "create",
      resource: {
        campaign: "customers/1234567890/campaigns/-2",
        language: { language_constant: "languageConstants/1000" },
      },
    });
  });

  it("throws before mutateResources when geoTargetConstant is empty", async () => {
    mutateResourcesMock.mockClear();
    const { createFullGoogleCampaign } = await import("./tools");
    await expect(
      createFullGoogleCampaign({
        name: "Whitefield Search",
        dailyBudgetInr: 500,
        geoTargetConstant: "",
        languageConstant: "languageConstants/1000",
        adGroupName: "Whitefield Office Space",
        keywords: [{ text: "office space whitefield", matchType: "phrase" }],
        negativeKeywords: [],
        headlines: ["Office Space in Whitefield"],
        descriptions: ["Skip the broker games."],
        finalUrl: "https://www.gentlespacesolutions.com/spaces",
      }),
    ).rejects.toThrow("geoTargetConstant must be a geoTargetConstants/ resource name");
    expect(mutateResourcesMock).not.toHaveBeenCalled();
  });
});

const shareCampaignInput = {
  name: "Whitefield Share",
  totalBudgetMinor: 50_000,
  geoTargetConstant: "geoTargetConstants/2356",
  languageConstant: "languageConstants/1000",
  adGroupName: "Whitefield Office Space",
  keywords: [{ text: "office space whitefield", matchType: "phrase" as const }],
  negativeKeywords: ["residential"],
  headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
  descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
  finalUrl: "https://www.gentlespacesolutions.com/spaces",
};

describe("createGoogleShareCampaign", () => {
  it("creates a paused campaign with total_amount_micros only and returns the numeric campaign id", async () => {
    queryMock.mockResolvedValue([]);
    mutateResourcesMock.mockResolvedValue({
      mutate_operation_responses: [
        { campaign_budget_result: { resource_name: "customers/1234567890/campaignBudgets/-1" } },
        { campaign_result: { resource_name: "customers/1234567890/campaigns/999" } },
        { campaign_criterion_result: { resource_name: "customers/1234567890/campaignCriteria/-2~-1" } },
        { campaign_criterion_result: { resource_name: "customers/1234567890/campaignCriteria/-2~-2" } },
        { ad_group_result: { resource_name: "customers/1234567890/adGroups/-3" } },
        { ad_group_criterion_result: { resource_name: "customers/1234567890/adGroupCriteria/-3~-4" } },
        { ad_group_criterion_result: { resource_name: "customers/1234567890/adGroupCriteria/-3~-5" } },
        { ad_group_ad_result: { resource_name: "customers/1234567890/adGroupAds/-3~-6" } },
      ],
    });
    const { createGoogleShareCampaign } = await import("./tools");
    const campaignId = await createGoogleShareCampaign(shareCampaignInput);

    expect(campaignId).toBe(999);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("campaign.name = 'Whitefield Share'"));
    const operations = mutateResourcesMock.mock.calls[0][0];
    expect(operations[0].resource).toMatchObject({ total_amount_micros: 500_000_000 });
    expect(operations[0].resource).not.toHaveProperty("amount_micros");
    expect(operations[1].resource).toMatchObject({ status: 3 });
  });

  it("returns an existing campaign id without calling mutateResources when the name already exists", async () => {
    queryMock.mockResolvedValue([{ campaign: { id: 4242 } }]);
    mutateResourcesMock.mockClear();
    const { createGoogleShareCampaign } = await import("./tools");
    const campaignId = await createGoogleShareCampaign(shareCampaignInput);
    expect(campaignId).toBe(4242);
    expect(mutateResourcesMock).not.toHaveBeenCalled();
  });
});

describe("updateGoogleShareBudget", () => {
  it("resolves campaign_budget via GAQL and sets total_amount_micros only", async () => {
    queryMock.mockResolvedValue([
      { campaign: { campaign_budget: "customers/1234567890/campaignBudgets/42" } },
    ]);
    mutateResourcesMock.mockResolvedValue({ mutate_operation_responses: [{}] });
    const { updateGoogleShareBudget } = await import("./tools");
    await updateGoogleShareBudget("customers/1234567890/campaigns/999", 75_000);
    expect(mutateResourcesMock).toHaveBeenCalledWith([
      {
        entity: "campaign_budget",
        operation: "update",
        resource: {
          resource_name: "customers/1234567890/campaignBudgets/42",
          total_amount_micros: 750_000_000,
        },
      },
    ]);
    expect(mutateResourcesMock.mock.calls[0][0][0].resource).not.toHaveProperty("amount_micros");
  });
});

describe("pauseGoogleCampaign", () => {
  it("sends a campaign update operation with status PAUSED", async () => {
    mutateResourcesMock.mockResolvedValue({ mutate_operation_responses: [{}] });
    const { pauseGoogleCampaign } = await import("./tools");
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

describe("enableGoogleShareCampaign", () => {
  it("sends a campaign update operation with status ENABLED", async () => {
    mutateResourcesMock.mockResolvedValue({ mutate_operation_responses: [{}] });
    const { enableGoogleShareCampaign } = await import("./tools");
    await enableGoogleShareCampaign("customers/1234567890/campaigns/999");
    expect(mutateResourcesMock).toHaveBeenCalledWith([
      {
        entity: "campaign",
        operation: "update",
        resource: { resource_name: "customers/1234567890/campaigns/999", status: 2 },
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
    const { updateGoogleCampaignBudget } = await import("./tools");
    await updateGoogleCampaignBudget("customers/1234567890/campaigns/999", 750);
    expect(mutateResourcesMock).toHaveBeenCalledWith([
      {
        entity: "campaign_budget",
        operation: "update",
        resource: { resource_name: "customers/1234567890/campaignBudgets/42", amount_micros: 750_000_000 },
      },
    ]);
  });
});

describe("addGoogleNegativeKeyword", () => {
  it("creates a negative campaign criterion", async () => {
    mutateResourcesMock.mockResolvedValue({ mutate_operation_responses: [{}] });
    const { addGoogleNegativeKeyword } = await import("./tools");
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

describe("proposeChange", () => {
  it("calls createProposal with the given input and returns the new proposal id", async () => {
    createProposalMock.mockResolvedValue({
      id: "prop-99",
      kind: "campaign_strategy",
      campaignId: null,
      payload: { summary: "Shift budget toward Whitefield", recommendations: [] },
      triggeredRule: "hermes:campaign_strategy",
      rationale: "Search volume up 30% in Whitefield this week",
      status: "pending",
      error: null,
      createdAt: "2026-08-10T00:00:00.000Z",
      decidedAt: null,
      executedAt: null,
    });
    const { proposeChange } = await import("./tools");
    const input = {
      kind: "campaign_strategy" as const,
      campaignId: null,
      payload: { summary: "Shift budget toward Whitefield", recommendations: [] },
      triggeredRule: "hermes:campaign_strategy",
      rationale: "Search volume up 30% in Whitefield this week",
    };

    const result = await proposeChange(input);

    expect(result).toEqual({ proposalId: "prop-99" });
    expect(createProposalMock).toHaveBeenCalledWith({ kind: "org", orgId: "org-1" }, input);
  });
});
