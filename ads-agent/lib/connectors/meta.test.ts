import { beforeEach, describe, expect, it, vi } from "vitest";

const initMock = vi.fn();
const getInsightsMock = vi.fn();
const createCampaignMock = vi.fn();
const updateMock = vi.fn();

class FakeAdAccount {
  id: string;
  constructor(id: string) {
    this.id = id;
  }
  getInsights = getInsightsMock;
  createCampaign = createCampaignMock;
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
  static Objective = { link_clicks: "LINK_CLICKS" };
}

vi.mock("facebook-nodejs-business-sdk", () => ({
  default: {
    FacebookAdsApi: { init: initMock },
    AdAccount: FakeAdAccount,
    Campaign: FakeCampaign,
  },
}));

beforeEach(() => {
  vi.resetModules();
  process.env.META_ACCESS_TOKEN = "token";
  process.env.META_AD_ACCOUNT_ID = "12345";
  initMock.mockReset();
  getInsightsMock.mockReset();
  createCampaignMock.mockReset();
  updateMock.mockReset();
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
