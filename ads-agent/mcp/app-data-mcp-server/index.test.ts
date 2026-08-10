import { beforeEach, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

const crmMock = vi.hoisted(() => ({
  crmToolProvider: {
    list_opportunities: vi.fn(),
    search_opportunities: vi.fn(),
    get_opportunity: vi.fn(),
  },
}));
const analyticsMock = vi.hoisted(() => ({
  analyticsToolProvider: {
    get_spend_cpl_trend: vi.fn(),
    list_campaigns_with_cpl: vi.fn(),
    list_pending_proposals: vi.fn(),
  },
}));
vi.mock("../../lib/openui/crm-tools", () => crmMock);
vi.mock("../../lib/openui/analytics-tools", () => analyticsMock);

import { afterEach, vi } from "vitest";
import { buildAppDataMcpServer } from "./index";

beforeEach(() => {
  vi.clearAllMocks();
});

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildAppDataMcpServer();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const TOOL_NAMES = [
  "list_opportunities",
  "search_opportunities",
  "get_opportunity",
  "get_spend_cpl_trend",
  "list_campaigns_with_cpl",
  "list_pending_proposals",
];

describe("buildAppDataMcpServer", () => {
  it("registers exactly 6 read-only tools — no advance_opportunity_stage", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools.map((t) => t.name)).not.toContain("advance_opportunity_stage");
    await client.close();
  });

  it("list_opportunities delegates to crmToolProvider.list_opportunities", async () => {
    crmMock.crmToolProvider.list_opportunities.mockResolvedValue({ opportunities: [{ name: "Acme" }] });
    const client = await connectedClient();
    const result = await client.callTool({ name: "list_opportunities", arguments: {} });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual({ opportunities: [{ name: "Acme" }] });
    expect(crmMock.crmToolProvider.list_opportunities).toHaveBeenCalledWith({});
    await client.close();
  });

  it("search_opportunities delegates with the query argument", async () => {
    crmMock.crmToolProvider.search_opportunities.mockResolvedValue({ opportunities: [] });
    const client = await connectedClient();
    await client.callTool({ name: "search_opportunities", arguments: { query: "Priya" } });
    expect(crmMock.crmToolProvider.search_opportunities).toHaveBeenCalledWith({ query: "Priya" });
    await client.close();
  });

  it("get_opportunity delegates with the id argument", async () => {
    crmMock.crmToolProvider.get_opportunity.mockResolvedValue(null);
    const client = await connectedClient();
    await client.callTool({ name: "get_opportunity", arguments: { id: "opp-1" } });
    expect(crmMock.crmToolProvider.get_opportunity).toHaveBeenCalledWith({ id: "opp-1" });
    await client.close();
  });

  it("get_spend_cpl_trend delegates with the days argument, defaulting to {}", async () => {
    analyticsMock.analyticsToolProvider.get_spend_cpl_trend.mockResolvedValue([]);
    const client = await connectedClient();
    await client.callTool({ name: "get_spend_cpl_trend", arguments: { days: 14 } });
    expect(analyticsMock.analyticsToolProvider.get_spend_cpl_trend).toHaveBeenCalledWith({ days: 14 });
    await client.close();
  });

  it("list_campaigns_with_cpl delegates to analyticsToolProvider.list_campaigns_with_cpl", async () => {
    analyticsMock.analyticsToolProvider.list_campaigns_with_cpl.mockResolvedValue([]);
    const client = await connectedClient();
    await client.callTool({ name: "list_campaigns_with_cpl", arguments: {} });
    expect(analyticsMock.analyticsToolProvider.list_campaigns_with_cpl).toHaveBeenCalledWith({});
    await client.close();
  });

  it("list_pending_proposals delegates to analyticsToolProvider.list_pending_proposals", async () => {
    analyticsMock.analyticsToolProvider.list_pending_proposals.mockResolvedValue([]);
    const client = await connectedClient();
    await client.callTool({ name: "list_pending_proposals", arguments: {} });
    expect(analyticsMock.analyticsToolProvider.list_pending_proposals).toHaveBeenCalledWith({});
    await client.close();
  });
});

describe("resolveAppDataMcpAllowedHosts", () => {
  const originalEnv = process.env.APP_DATA_MCP_ALLOWED_HOSTS;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.APP_DATA_MCP_ALLOWED_HOSTS;
    else process.env.APP_DATA_MCP_ALLOWED_HOSTS = originalEnv;
  });

  it("defaults to localhost and 127.0.0.1 when unset", async () => {
    delete process.env.APP_DATA_MCP_ALLOWED_HOSTS;
    const { resolveAppDataMcpAllowedHosts } = await import("./index");
    expect(resolveAppDataMcpAllowedHosts()).toEqual(["localhost", "127.0.0.1"]);
  });
});

describe("resolveAppDataMcpBind", () => {
  const originalEnv = process.env.APP_DATA_MCP_BIND;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.APP_DATA_MCP_BIND;
    else process.env.APP_DATA_MCP_BIND = originalEnv;
  });

  it("defaults to localhost when unset", async () => {
    delete process.env.APP_DATA_MCP_BIND;
    const { resolveAppDataMcpBind } = await import("./index");
    expect(resolveAppDataMcpBind()).toBe("localhost");
  });
});
