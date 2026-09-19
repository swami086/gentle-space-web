import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { GoogleAdsMcpSurface } from "./surface";

const toolsMock = vi.hoisted(() => ({
  fetchGoogleAdsPerformance: vi.fn(),
  fetchGoogleSearchTerms: vi.fn(),
  listAccessibleCustomers: vi.fn(),
  createFullGoogleCampaign: vi.fn(),
  pauseGoogleCampaign: vi.fn(),
  updateGoogleCampaignBudget: vi.fn(),
  addGoogleNegativeKeyword: vi.fn(),
  proposeChange: vi.fn(),
}));
vi.mock("./tools", () => toolsMock);

import { buildGoogleAdsMcpServer } from "./index";
import { resolveGoogleAdsMcpPort, resolveGoogleAdsMcpSurface } from "./surface";

beforeEach(() => {
  vi.clearAllMocks();
});

async function registeredToolNames(surface: GoogleAdsMcpSurface) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildGoogleAdsMcpServer(surface);
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  await client.close();
  return names;
}

async function connectedClient(surface: GoogleAdsMcpSurface = "write") {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildGoogleAdsMcpServer(surface);
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("buildGoogleAdsMcpServer surface split", () => {
  it("read surface does not register create_campaign", async () => {
    const names = await registeredToolNames("read");
    expect(names).toEqual([
      "list_accessible_customers",
      "list_campaign_performance",
      "search_terms_report",
    ]);
    expect(names).not.toContain("create_campaign");
  });

  it("write surface registers mutate tools and not list_campaign_performance", async () => {
    const names = await registeredToolNames("write");
    expect(names).toEqual([
      "add_negative_keyword",
      "create_campaign",
      "pause_campaign",
      "propose_change",
      "update_campaign_budget",
    ]);
    expect(names).not.toContain("list_campaign_performance");
  });
});

describe("buildGoogleAdsMcpServer tool handlers", () => {
  it("list_campaign_performance calls fetchGoogleAdsPerformance and returns its rows as JSON", async () => {
    toolsMock.fetchGoogleAdsPerformance.mockResolvedValue([
      { externalCampaignId: "1", spend: 1, clicks: 1, impressions: 1, conversions: 0 },
    ]);
    const client = await connectedClient("read");
    const result = await client.callTool({ name: "list_campaign_performance", arguments: {} });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual([{ externalCampaignId: "1", spend: 1, clicks: 1, impressions: 1, conversions: 0 }]);
    await client.close();
  });

  it("pause_campaign calls pauseGoogleCampaign with the given resource name", async () => {
    toolsMock.pauseGoogleCampaign.mockResolvedValue(undefined);
    const client = await connectedClient("write");
    await client.callTool({ name: "pause_campaign", arguments: { campaignResourceName: "customers/1/campaigns/2" } });
    expect(toolsMock.pauseGoogleCampaign).toHaveBeenCalledWith("customers/1/campaigns/2");
    await client.close();
  });

  it("create_campaign calls createFullGoogleCampaign with the parsed input and returns its resource name", async () => {
    toolsMock.createFullGoogleCampaign.mockResolvedValue("customers/1/campaigns/999");
    const client = await connectedClient("write");
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

  it("propose_change calls proposeChange with the parsed input and returns the new proposal id", async () => {
    toolsMock.proposeChange.mockResolvedValue({ proposalId: "prop-99" });
    const client = await connectedClient("write");
    const input = {
      kind: "campaign_strategy" as const,
      campaignId: null,
      payload: { summary: "Shift budget toward Whitefield", recommendations: [] },
      triggeredRule: "hermes:campaign_strategy",
    };
    const result = await client.callTool({ name: "propose_change", arguments: input });
    expect(toolsMock.proposeChange).toHaveBeenCalledWith(input);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual({ proposalId: "prop-99" });
    await client.close();
  });
});

describe("resolveGoogleAdsMcpSurface", () => {
  it('defaults to read when unset or invalid', () => {
    expect(resolveGoogleAdsMcpSurface({})).toBe("read");
    expect(resolveGoogleAdsMcpSurface({ GOOGLE_ADS_MCP_SURFACE: "bogus" })).toBe("read");
  });

  it('returns write only when GOOGLE_ADS_MCP_SURFACE is exactly "write"', () => {
    expect(resolveGoogleAdsMcpSurface({ GOOGLE_ADS_MCP_SURFACE: "write" })).toBe("write");
  });
});

describe("resolveGoogleAdsMcpPort", () => {
  it("defaults to 8766 when unset or invalid", () => {
    expect(resolveGoogleAdsMcpPort({})).toBe(8766);
    expect(resolveGoogleAdsMcpPort({ GOOGLE_ADS_MCP_PORT: "nope" })).toBe(8766);
  });

  it("honors GOOGLE_ADS_MCP_PORT when valid", () => {
    expect(resolveGoogleAdsMcpPort({ GOOGLE_ADS_MCP_PORT: "8769" })).toBe(8769);
  });
});

describe("resolveGoogleAdsMcpAllowedHosts", () => {
  const originalEnv = process.env.GOOGLE_ADS_MCP_ALLOWED_HOSTS;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.GOOGLE_ADS_MCP_ALLOWED_HOSTS;
    else process.env.GOOGLE_ADS_MCP_ALLOWED_HOSTS = originalEnv;
  });

  it("defaults to localhost and 127.0.0.1 when unset", async () => {
    delete process.env.GOOGLE_ADS_MCP_ALLOWED_HOSTS;
    const { resolveGoogleAdsMcpAllowedHosts } = await import("./index");
    expect(resolveGoogleAdsMcpAllowedHosts()).toEqual(["localhost", "127.0.0.1"]);
  });

  it("parses a comma-separated allowlist, trimming whitespace", async () => {
    process.env.GOOGLE_ADS_MCP_ALLOWED_HOSTS = "google-ads-mcp, localhost , 127.0.0.1";
    const { resolveGoogleAdsMcpAllowedHosts } = await import("./index");
    expect(resolveGoogleAdsMcpAllowedHosts()).toEqual(["google-ads-mcp", "localhost", "127.0.0.1"]);
  });
});

describe("resolveGoogleAdsMcpBind", () => {
  const originalEnv = process.env.GOOGLE_ADS_MCP_BIND;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.GOOGLE_ADS_MCP_BIND;
    else process.env.GOOGLE_ADS_MCP_BIND = originalEnv;
  });

  it("defaults to localhost when unset", async () => {
    delete process.env.GOOGLE_ADS_MCP_BIND;
    const { resolveGoogleAdsMcpBind } = await import("./index");
    expect(resolveGoogleAdsMcpBind()).toBe("localhost");
  });

  it("returns the trimmed GOOGLE_ADS_MCP_BIND value when set", async () => {
    process.env.GOOGLE_ADS_MCP_BIND = " 0.0.0.0 ";
    const { resolveGoogleAdsMcpBind } = await import("./index");
    expect(resolveGoogleAdsMcpBind()).toBe("0.0.0.0");
  });
});
