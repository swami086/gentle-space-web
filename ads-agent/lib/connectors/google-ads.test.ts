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

describe("createGoogleCampaign", () => {
  it("creates a budget and campaign atomically and returns the campaign resource name", async () => {
    mutateResourcesMock.mockResolvedValue({
      mutate_operation_responses: [
        { campaign_budget_result: { resource_name: "customers/1234567890/campaignBudgets/-1" } },
        { campaign_result: { resource_name: "customers/1234567890/campaigns/999" } },
      ],
    });
    const { createGoogleCampaign } = await import("./google-ads");
    const resourceName = await createGoogleCampaign({ name: "Whitefield Search", dailyBudgetInr: 500 });
    expect(resourceName).toBe("customers/1234567890/campaigns/999");
    expect(mutateResourcesMock).toHaveBeenCalledTimes(1);
    const operations = mutateResourcesMock.mock.calls[0][0];
    expect(operations).toHaveLength(2);
    expect(operations[0].entity).toBe("campaign_budget");
    expect(operations[1].entity).toBe("campaign");
    expect(operations[1].resource.name).toBe("Whitefield Search");
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
