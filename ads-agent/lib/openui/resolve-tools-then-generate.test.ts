// ads-agent/lib/openui/resolve-tools-then-generate.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callMeteredChatCompletion, listTwentyTools, callTwentyTool, listGoogleAdsTools, callGoogleAdsTool } = vi.hoisted(() => ({
  callMeteredChatCompletion: vi.fn(),
  listTwentyTools: vi.fn(),
  callTwentyTool: vi.fn(),
  listGoogleAdsTools: vi.fn(),
  callGoogleAdsTool: vi.fn(),
}));
vi.mock("../metering/metered-client", () => ({ callMeteredChatCompletion }));
vi.mock("../bifrost/mcp-client", () => ({ listTwentyTools, callTwentyTool }));
vi.mock("../bifrost/google-ads-mcp-client", () => ({ listGoogleAdsTools, callGoogleAdsTool }));

import { resolveToolsThenGenerate } from "./resolve-tools-then-generate";
import type { MeteringContext } from "../metering/types";

const ctx: MeteringContext = { orgId: "org-1", userId: "user-1", feature: "test" };
const PLATFORM = { kind: "platform" as const, orgId: "org-1" };
const baseMessages = [
  { role: "system" as const, content: "sys" },
  { role: "user" as const, content: "show me hot leads" },
];
const readOnlySchemas = [
  { name: "list_opportunities", description: "List opportunities", inputSchema: { type: "object" } },
  { name: "get_opportunity", description: "Get one opportunity", inputSchema: { type: "object" } },
];
const googleAdsReadSchemas = [
  { name: "list_campaign_performance", description: "List campaign performance", inputSchema: { type: "object" } },
  { name: "search_terms_report", description: "Search terms report", inputSchema: { type: "object" } },
  { name: "list_accessible_customers", description: "List accessible customers", inputSchema: { type: "object" } },
];

beforeEach(() => {
  callMeteredChatCompletion.mockReset();
  listTwentyTools.mockReset().mockResolvedValue([
    ...readOnlySchemas,
    { name: "update_opportunity", description: "Update", inputSchema: { type: "object" } },
  ]);
  callTwentyTool.mockReset();
  listGoogleAdsTools.mockReset().mockResolvedValue([
    ...googleAdsReadSchemas,
    { name: "pause_campaign", description: "Pause", inputSchema: { type: "object" } },
    { name: "create_campaign", description: "Create", inputSchema: { type: "object" } },
    { name: "update_campaign_budget", description: "Budget", inputSchema: { type: "object" } },
    { name: "add_negative_keyword", description: "Negative", inputSchema: { type: "object" } },
  ]);
  callGoogleAdsTool.mockReset();
});

describe("resolveToolsThenGenerate", () => {
  it("returns the original messages unchanged when the model requests no tools", async () => {
    callMeteredChatCompletion.mockResolvedValue({
      choices: [{ message: { role: "assistant", content: "no tools needed" } }],
    });

    const result = await resolveToolsThenGenerate(ctx, baseMessages, PLATFORM);

    expect(result).toEqual(baseMessages);
    expect(callTwentyTool).not.toHaveBeenCalled();
    const [, options] = callMeteredChatCompletion.mock.calls[0];
    expect(options.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual([
      "list_opportunities",
      "get_opportunity",
      "list_campaign_performance",
      "search_terms_report",
      "list_accessible_customers",
    ]);
  });

  it("executes a read tool call and appends reshaped OpenUI card rows (not raw CRM fields)", async () => {
    const toolCall = { id: "call_1", type: "function" as const, function: { name: "list_opportunities", arguments: "{}" } };
    callMeteredChatCompletion
      .mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: null, tool_calls: [toolCall] } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: "done" } }] } as never);
    callTwentyTool.mockResolvedValue({
      records: [
        {
          id: "opp-1",
          name: "Office: Priya Sharma",
          stage: "SHORTLIST",
          tier: "HOT",
          amount: { amountMicros: 15000000000, currencyCode: "INR" },
          pointOfContact: {
            name: { firstName: "Priya", lastName: "Sharma" },
            phones: { primaryPhoneNumber: "8800001234", primaryPhoneCallingCode: "+91" },
          },
          source: "WhatsApp",
          listingName: "Koramangala",
          createdAt: "2026-08-01T00:00:00.000Z",
          companyId: "co-1",
          ownerId: "user-1",
        },
      ],
    });

    const result = await resolveToolsThenGenerate(ctx, baseMessages, PLATFORM);

    const openUiRows = [
      {
        name: "Office: Priya Sharma",
        stage: "SHORTLIST",
        tier: "HOT",
        amountLabel: "₹15,000",
        maskedPhone: "+91 8XXXXX-1234",
        source: "WhatsApp",
      },
    ];
    expect(result).toEqual([
      ...baseMessages,
      { role: "assistant", content: null, tool_calls: [toolCall] },
      { role: "tool", content: JSON.stringify(openUiRows), tool_call_id: "call_1" },
    ]);
    expect(callTwentyTool).toHaveBeenCalledWith("list_opportunities", {});
    expect(callMeteredChatCompletion).toHaveBeenCalledTimes(2);
  });

  it("executes multiple read tool calls from a single round in parallel", async () => {
    const call1 = { id: "call_1", type: "function" as const, function: { name: "list_opportunities", arguments: "{}" } };
    const call2 = { id: "call_2", type: "function" as const, function: { name: "get_opportunity", arguments: '{"id":"2"}' } };
    callMeteredChatCompletion
      .mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: null, tool_calls: [call1, call2] } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: "done" } }] } as never);
    callTwentyTool.mockResolvedValueOnce([]).mockResolvedValueOnce({});

    const result = await resolveToolsThenGenerate(ctx, baseMessages, PLATFORM);

    expect(result).toHaveLength(baseMessages.length + 3);
    expect(callTwentyTool).toHaveBeenCalledTimes(2);
  });

  it("rejects any tool-call name outside the two advertised read tools, and stops the loop", async () => {
    const mutatingCall = { id: "call_1", type: "function" as const, function: { name: "update_opportunity", arguments: '{"id":"1","stage":"TOUR"}' } };
    callMeteredChatCompletion.mockResolvedValue({ choices: [{ message: { role: "assistant", content: null, tool_calls: [mutatingCall] } }] } as never);

    const result = await resolveToolsThenGenerate(ctx, baseMessages, PLATFORM);

    expect(callTwentyTool).not.toHaveBeenCalled();
    expect(result).toEqual(baseMessages);
  });

  it("stops after 2 rounds even if the model keeps requesting tools", async () => {
    const toolCall = { id: "call_1", type: "function" as const, function: { name: "list_opportunities", arguments: "{}" } };
    callMeteredChatCompletion.mockResolvedValue({ choices: [{ message: { role: "assistant", content: null, tool_calls: [toolCall] } }] } as never);
    callTwentyTool.mockResolvedValue([]);

    await resolveToolsThenGenerate(ctx, baseMessages, PLATFORM);

    expect(callMeteredChatCompletion).toHaveBeenCalledTimes(2);
    expect(callTwentyTool).toHaveBeenCalledTimes(2);
  });

  it("returns the original messages unchanged when both MCP servers are unreachable", async () => {
    listTwentyTools.mockRejectedValue(new Error("twenty-mcp-gateway unreachable"));
    listGoogleAdsTools.mockRejectedValue(new Error("google-ads-mcp unreachable"));
    callMeteredChatCompletion.mockResolvedValue({
      choices: [{ message: { role: "assistant", content: "no tools needed" } }],
    });
    const result = await resolveToolsThenGenerate(ctx, baseMessages, PLATFORM);
    expect(result).toEqual(baseMessages);
    const [, options] = callMeteredChatCompletion.mock.calls[0];
    expect(options.tools).toEqual([]);
  });

  it("returns the original messages unchanged when the resolve call itself throws", async () => {
    callMeteredChatCompletion.mockRejectedValue(new Error("bifrost unreachable"));
    const result = await resolveToolsThenGenerate(ctx, baseMessages, PLATFORM);
    expect(result).toEqual(baseMessages);
  });
});

describe("resolveToolsThenGenerate — Google Ads", () => {
  it("advertises all 3 Google Ads read tools alongside the 2 Twenty read tools, never the 4 Google Ads write tools", async () => {
    callMeteredChatCompletion.mockResolvedValue({
      choices: [{ message: { role: "assistant", content: "no tools needed" } }],
    });

    await resolveToolsThenGenerate(ctx, baseMessages, PLATFORM);

    const [, options] = callMeteredChatCompletion.mock.calls[0];
    const names = options.tools.map((t: { function: { name: string } }) => t.function.name);
    expect(names).toEqual([
      "list_opportunities",
      "get_opportunity",
      "list_campaign_performance",
      "search_terms_report",
      "list_accessible_customers",
    ]);
  });

  it("executes a Google Ads read tool call via callGoogleAdsTool (not callTwentyTool) and appends the raw result", async () => {
    const toolCall = {
      id: "call_1",
      type: "function" as const,
      function: { name: "list_campaign_performance", arguments: "{}" },
    };
    callMeteredChatCompletion
      .mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: null, tool_calls: [toolCall] } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: "done" } }] } as never);
    const rows = [{ externalCampaignId: "111", spend: 40.5, clicks: 12, impressions: 900, conversions: 1 }];
    callGoogleAdsTool.mockResolvedValue(rows);

    const result = await resolveToolsThenGenerate(ctx, baseMessages, PLATFORM);

    expect(result).toEqual([
      ...baseMessages,
      { role: "assistant", content: null, tool_calls: [toolCall] },
      { role: "tool", content: JSON.stringify(rows), tool_call_id: "call_1" },
    ]);
    expect(callGoogleAdsTool).toHaveBeenCalledWith("list_campaign_performance", {});
    expect(callTwentyTool).not.toHaveBeenCalled();
  });

  it("rejects a Google Ads write tool name even if the model requests it", async () => {
    const mutatingCall = {
      id: "call_1",
      type: "function" as const,
      function: { name: "pause_campaign", arguments: '{"campaignResourceName":"x"}' },
    };
    callMeteredChatCompletion.mockResolvedValue({
      choices: [{ message: { role: "assistant", content: null, tool_calls: [mutatingCall] } }],
    } as never);

    const result = await resolveToolsThenGenerate(ctx, baseMessages, PLATFORM);

    expect(callGoogleAdsTool).not.toHaveBeenCalled();
    expect(result).toEqual(baseMessages);
  });

  it("still advertises Twenty's read tools when the Google Ads MCP server is unreachable", async () => {
    listGoogleAdsTools.mockRejectedValue(new Error("google-ads-mcp unreachable"));
    callMeteredChatCompletion.mockResolvedValue({
      choices: [{ message: { role: "assistant", content: "no tools needed" } }],
    });

    await resolveToolsThenGenerate(ctx, baseMessages, PLATFORM);

    const [, options] = callMeteredChatCompletion.mock.calls[0];
    const names = options.tools.map((t: { function: { name: string } }) => t.function.name);
    expect(names).toEqual(["list_opportunities", "get_opportunity"]);
  });
});
