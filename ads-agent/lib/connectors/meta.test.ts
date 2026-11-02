import { beforeEach, describe, expect, it, vi } from "vitest";

const initMock = vi.fn();
const getInsightsMock = vi.fn();
const createCampaignMock = vi.fn();
const createAdSetMock = vi.fn();
const createAdCreativeMock = vi.fn();
const createAdMock = vi.fn();
const createLeadGenFormMock = vi.fn();
const updateMock = vi.fn();
const axiosPostMock = vi.fn();

class FakeFacebookAdsApi {
  accessToken: string;
  call = vi.fn();

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  static init = initMock;
  static GRAPH = "https://graph.facebook.com";
  static VERSION = "v22.0";
  static SDK_VERSION = "22.0.3";
  static _encodeParams = (params: Record<string, unknown>) =>
    Object.entries(params)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join("&");
}

class FakeAdAccount {
  id: string;
  constructor(id: string) {
    this.id = id;
  }
  getInsights = getInsightsMock;
  createCampaign = createCampaignMock;
  createAdSet = createAdSetMock;
  createAdCreative = createAdCreativeMock;
  createAd = createAdMock;
}

class FakePage {
  id: string;
  constructor(id: string) {
    this.id = id;
  }
  createLeadGenForm = createLeadGenFormMock;
}

class FakeCampaign {
  id: string;
  constructor(id: string) {
    this.id = id;
  }
  update = updateMock;
  static Fields = {
    name: "name",
    status: "status",
    objective: "objective",
    daily_budget: "daily_budget",
    campaign_id: "campaign_id",
  };
  static Status = { active: "ACTIVE", paused: "PAUSED" };
  static Objective = { link_clicks: "LINK_CLICKS", outcome_leads: "OUTCOME_LEADS" };
}

class FakeAdSet {
  id: string;
  update = updateMock;
  constructor(id: string) {
    this.id = id;
  }
  static Fields = {
    name: "name",
    campaign_id: "campaign_id",
    lifetime_budget: "lifetime_budget",
    end_time: "end_time",
    status: "status",
    billing_event: "billing_event",
    optimization_goal: "optimization_goal",
    destination_type: "destination_type",
    bid_strategy: "bid_strategy",
    promoted_object: "promoted_object",
    targeting: "targeting",
  };
  static Status = { paused: "PAUSED" };
  static BillingEvent = { impressions: "IMPRESSIONS" };
  static OptimizationGoal = { lead_generation: "LEAD_GENERATION" };
  static DestinationType = { on_ad: "ON_AD" };
  static BidStrategy = { lowest_cost_without_cap: "LOWEST_COST_WITHOUT_CAP" };
}

class FakeAdCreative {
  static Fields = { name: "name", object_story_spec: "object_story_spec" };
}

class FakeAd {
  static Fields = { name: "name", adset_id: "adset_id", creative: "creative", status: "status" };
  static Status = { paused: "PAUSED" };
}

vi.mock("axios", () => ({
  default: vi.fn((config: { method?: string; headers?: Record<string, string> }) => {
    if (config.method === "POST") {
      return axiosPostMock(config);
    }
    return Promise.reject(new Error("unexpected axios call"));
  }),
}));

vi.mock("facebook-nodejs-business-sdk", () => ({
  FacebookAdsApi: FakeFacebookAdsApi,
  AdAccount: FakeAdAccount,
  Page: FakePage,
  Campaign: FakeCampaign,
  AdSet: FakeAdSet,
  AdCreative: FakeAdCreative,
  Ad: FakeAd,
}));

beforeEach(() => {
  vi.resetModules();
  process.env.META_ACCESS_TOKEN = "token";
  process.env.META_AD_ACCOUNT_ID = "12345";
  initMock.mockReset();
  getInsightsMock.mockReset();
  createCampaignMock.mockReset();
  createAdSetMock.mockReset();
  createAdCreativeMock.mockReset();
  createAdMock.mockReset();
  createLeadGenFormMock.mockReset();
  updateMock.mockReset();
  axiosPostMock.mockReset();
  axiosPostMock.mockImplementation(async () => ({ data: { id: "from-axios" } }));
});

describe("fetchMetaPerformance", () => {
  it("maps insight rows and initializes the API with the access token", async () => {
    getInsightsMock.mockResolvedValue([
      {
        campaign_id: "ext-1",
        spend: "40.50",
        clicks: "12",
        impressions: "900",
        actions: [{ action_type: "lead", value: "1" }],
      },
    ]);
    const { fetchMetaPerformance } = await import("./meta");
    const result = await fetchMetaPerformance();
    expect(initMock).toHaveBeenCalledWith("token");
    expect(result).toEqual([
      {
        externalCampaignId: "ext-1",
        spend: 40.5,
        clicks: 12,
        impressions: 900,
        conversions: 1,
      },
    ]);
  });

  it("treats a row with no lead action as zero conversions", async () => {
    getInsightsMock.mockResolvedValue([
      {
        campaign_id: "ext-2",
        spend: "10",
        clicks: "3",
        impressions: "80",
        actions: [],
      },
    ]);
    const { fetchMetaPerformance } = await import("./meta");
    const result = await fetchMetaPerformance();
    expect(result[0].conversions).toBe(0);
  });
});

describe("createMetaCampaign", () => {
  it("converts rupees to paise and returns the new campaign id", async () => {
    createCampaignMock.mockResolvedValue({ id: "ext-new" });
    const { createMetaCampaign } = await import("./meta");
    const id = await createMetaCampaign({
      name: "Whitefield Search",
      dailyBudgetInr: 500,
    });
    expect(id).toBe("ext-new");
    expect(createCampaignMock).toHaveBeenCalledWith([], {
      name: "Whitefield Search",
      status: "ACTIVE",
      objective: "LINK_CLICKS",
      daily_budget: 50000,
    });
  });
});

describe("pauseMetaCampaign", () => {
  it("updates status to paused", async () => {
    updateMock.mockResolvedValue({});
    const { pauseMetaCampaign } = await import("./meta");
    await pauseMetaCampaign("ext-1");
    expect(updateMock).toHaveBeenCalledWith({ status: "PAUSED" });
  });
});

describe("updateMetaCampaignBudget", () => {
  it("converts rupees to paise", async () => {
    updateMock.mockResolvedValue({});
    const { updateMetaCampaignBudget } = await import("./meta");
    await updateMetaCampaignBudget("ext-1", 750);
    expect(updateMock).toHaveBeenCalledWith({ daily_budget: 75000 });
  });
});

describe("createMetaListingShares", () => {
  it("creates the lead form first, then a paused campaign without budget and ad sets with lifetime budgets", async () => {
    const callOrder: string[] = [];
    createLeadGenFormMock.mockImplementation(async () => {
      callOrder.push("form");
      return { id: "form-1" };
    });
    let postCount = 0;
    axiosPostMock.mockImplementation(async (config: { data: Record<string, unknown> }) => {
      postCount += 1;
      if (postCount === 1) {
        callOrder.push("campaign");
        expect(config.data).toEqual({
          name: "Listing campaign",
          status: "PAUSED",
          objective: "OUTCOME_LEADS",
          special_ad_categories: ["NONE"],
        });
        expect(config.data).not.toHaveProperty("daily_budget");
        expect(config.data).not.toHaveProperty("lifetime_budget");
        return { data: { id: "camp-1" } };
      }
      if (postCount === 2) {
        callOrder.push("adset");
        expect(config.data.lifetime_budget).toBe(120000);
        expect(config.data.status).toBe("PAUSED");
        expect(config.data.campaign_id).toBe("camp-1");
        return { data: { id: "set-a" } };
      }
      if (postCount === 3) return { data: { id: "cr-1" } };
      return { data: { id: "ad-1" } };
    });

    const { createMetaListingShares } = await import("./meta");
    const result = await createMetaListingShares({
      proposalId: "prop-9",
      name: "Listing campaign",
      endTimeIso: "2026-12-01T00:00:00+0530",
      pageId: "page-1",
      shares: [
        {
          name: "Share A",
          lifetimeBudgetMinor: 120000,
          message: "Office in Whitefield",
          imageHash: "img-hash",
          link: "https://example.com/listing",
        },
      ],
    });

    expect(callOrder).toEqual(["form", "campaign", "adset"]);
    expect(createLeadGenFormMock.mock.invocationCallOrder[0]).toBeLessThan(
      axiosPostMock.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({
      campaignId: "camp-1",
      formId: "form-1",
      shares: [{ adSetId: "set-a", adId: "ad-1" }],
    });

    const idempotentCalls = axiosPostMock.mock.calls.map((call) => call[0].headers?.["X-Client-Idempotent-Key"]);
    expect(idempotentCalls).toContain("prop-9:Listing campaign");
    expect(idempotentCalls).toContain("prop-9:Share A");
    expect(createLeadGenFormMock).toHaveBeenCalledTimes(1);
    expect(idempotentCalls.filter(Boolean).length).toBe(4);
  });
});

describe("updateMetaAdSetLifetimeBudget", () => {
  it("updates lifetime_budget in minor units", async () => {
    updateMock.mockResolvedValue({});
    const { updateMetaAdSetLifetimeBudget } = await import("./meta");
    await updateMetaAdSetLifetimeBudget("set-1", 99000);
    expect(updateMock).toHaveBeenCalledWith({ lifetime_budget: 99000 });
  });
});
