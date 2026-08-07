import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

const toolsMock = vi.hoisted(() => ({
  fetchGoogleAdsPerformance: vi.fn(),
  fetchGoogleSearchTerms: vi.fn(),
  listAccessibleCustomers: vi.fn(),
  createFullGoogleCampaign: vi.fn(),
  pauseGoogleCampaign: vi.fn(),
  updateGoogleCampaignBudget: vi.fn(),
  addGoogleNegativeKeyword: vi.fn(),
}));
vi.mock("./tools", () => toolsMock);

import { buildGoogleAdsMcpServer } from "./index";

beforeEach(() => {
  vi.clearAllMocks();
});

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildGoogleAdsMcpServer();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const READ_TOOL_NAMES = ["list_campaign_performance", "search_terms_report", "list_accessible_customers"];
const WRITE_TOOL_NAMES = ["create_campaign", "pause_campaign", "update_campaign_budget", "add_negative_keyword"];

describe("buildGoogleAdsMcpServer", () => {
  it("registers exactly 7 tools: 3 read + 4 write", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].sort());
    await client.close();
  });

  it("list_campaign_performance calls fetchGoogleAdsPerformance and returns its rows as JSON", async () => {
    toolsMock.fetchGoogleAdsPerformance.mockResolvedValue([
      { externalCampaignId: "1", spend: 1, clicks: 1, impressions: 1, conversions: 0 },
    ]);
    const client = await connectedClient();
    const result = await client.callTool({ name: "list_campaign_performance", arguments: {} });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual([{ externalCampaignId: "1", spend: 1, clicks: 1, impressions: 1, conversions: 0 }]);
    await client.close();
  });

  it("pause_campaign calls pauseGoogleCampaign with the given resource name", async () => {
    toolsMock.pauseGoogleCampaign.mockResolvedValue(undefined);
    const client = await connectedClient();
    await client.callTool({ name: "pause_campaign", arguments: { campaignResourceName: "customers/1/campaigns/2" } });
    expect(toolsMock.pauseGoogleCampaign).toHaveBeenCalledWith("customers/1/campaigns/2");
    await client.close();
  });

  it("create_campaign calls createFullGoogleCampaign with the parsed input and returns its resource name", async () => {
    toolsMock.createFullGoogleCampaign.mockResolvedValue("customers/1/campaigns/999");
    const client = await connectedClient();
    const input = {
      name: "Whitefield Search",
      dailyBudgetInr: 500,
      adGroupName: "Whitefield Office Space",
      keywords: [{ text: "office space whitefield", matchType: "phrase" as const }],
      negativeKeywords: ["residential"],
      headlines: ["Office Space in Whitefield"],
      descriptions: ["Skip the broker games."],
      finalUrl: "https://www.gentlespacesolutions.com/spaces",
    };
    const result = await client.callTool({ name: "create_campaign", arguments: input });
    expect(toolsMock.createFullGoogleCampaign).toHaveBeenCalledWith(input);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual({ resourceName: "customers/1/campaigns/999" });
    await client.close();
  });
});
