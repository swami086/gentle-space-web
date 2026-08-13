import { beforeEach, describe, expect, it, vi } from "vitest";

const scope = { kind: "org" as const, orgId: "10101010-1010-1010-1010-101010101010" };

const campaignMock = { start_campaign_draft: vi.fn() };
const crmMock = { list_opportunities: vi.fn() };
const analyticsMock = { get_spend_cpl_trend: vi.fn() };

const { createCampaignToolProvider, createCrmToolProvider, createAnalyticsToolProvider } = vi.hoisted(
  () => ({
    createCampaignToolProvider: vi.fn(() => campaignMock),
    createCrmToolProvider: vi.fn(() => crmMock),
    createAnalyticsToolProvider: vi.fn(() => analyticsMock),
  }),
);

vi.mock("./campaign-tools", () => ({
  createCampaignToolProvider,
  campaignToolSpecs: [{ name: "start_campaign_draft" }],
}));
vi.mock("./crm-tools", () => ({
  createCrmToolProvider,
  crmToolSpecs: [{ name: "list_opportunities" }],
}));
vi.mock("./analytics-tools", () => ({
  createAnalyticsToolProvider,
  analyticsToolSpecs: [{ name: "get_spend_cpl_trend" }],
}));

import { composeToolProviders, createPlatformToolProvider, platformToolSpecs } from "./platform-tools";

beforeEach(() => {
  createCampaignToolProvider.mockClear();
  createCrmToolProvider.mockClear();
  createAnalyticsToolProvider.mockClear();
  campaignMock.start_campaign_draft.mockReset();
  crmMock.list_opportunities.mockReset();
  analyticsMock.get_spend_cpl_trend.mockReset();
});

describe("createPlatformToolProvider", () => {
  it("passes the session scope to every domain factory", () => {
    createPlatformToolProvider(scope);

    expect(createCampaignToolProvider).toHaveBeenCalledWith(scope);
    expect(createCrmToolProvider).toHaveBeenCalledWith(scope);
    expect(createAnalyticsToolProvider).toHaveBeenCalledWith(scope);
  });

  it("merges tools from campaign, CRM, and analytics domains", async () => {
    campaignMock.start_campaign_draft.mockResolvedValue({ id: "draft-1", path: "/campaigns/drafts/draft-1" });
    crmMock.list_opportunities.mockResolvedValue({ opportunities: [] });
    analyticsMock.get_spend_cpl_trend.mockResolvedValue([]);

    const provider = createPlatformToolProvider(scope);

    await provider.start_campaign_draft({});
    await provider.list_opportunities({});
    await provider.get_spend_cpl_trend({ days: 7 });

    expect(campaignMock.start_campaign_draft).toHaveBeenCalledWith({});
    expect(crmMock.list_opportunities).toHaveBeenCalledWith({});
    expect(analyticsMock.get_spend_cpl_trend).toHaveBeenCalledWith({ days: 7 });
  });
});

describe("composeToolProviders", () => {
  it("rejects duplicate tool names across domains", () => {
    expect(() =>
      composeToolProviders(
        { shared_tool: async () => "a" },
        { shared_tool: async () => "b" },
      ),
    ).toThrow(/duplicate tool name "shared_tool"/);
  });
});

describe("platformToolSpecs", () => {
  it("includes specs from every domain without duplicate names", () => {
    const names = platformToolSpecs.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("start_campaign_draft");
    expect(names).toContain("list_opportunities");
    expect(names).toContain("get_spend_cpl_trend");
  });
});
