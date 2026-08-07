import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.fn();
const listTools = vi.fn();
const callTool = vi.fn();
const close = vi.fn();

vi.mock("@modelcontextprotocol/client", () => ({
  Client: vi.fn().mockImplementation(function () {
    return { connect, listTools, callTool, close };
  }),
  StreamableHTTPClientTransport: vi.fn().mockImplementation(function (url: URL) {
    return { url };
  }),
}));

import { callGoogleAdsTool, listGoogleAdsTools } from "./google-ads-mcp-client";

beforeEach(() => {
  connect.mockReset().mockResolvedValue(undefined);
  listTools.mockReset();
  callTool.mockReset();
  close.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listGoogleAdsTools", () => {
  it("connects, lists tools, and closes the connection", async () => {
    listTools.mockResolvedValue({
      tools: [{ name: "list_campaign_performance", description: "List campaign performance", inputSchema: { type: "object" } }],
    });

    const tools = await listGoogleAdsTools();

    expect(tools).toEqual([
      { name: "list_campaign_performance", description: "List campaign performance", inputSchema: { type: "object" } },
    ]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("still closes the connection when listTools throws", async () => {
    listTools.mockRejectedValue(new Error("boom"));
    await expect(listGoogleAdsTools()).rejects.toThrow("boom");
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("callGoogleAdsTool", () => {
  it("calls callTool with name/arguments and returns the parsed text content", async () => {
    callTool.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify([{ externalCampaignId: "111", spend: 40.5 }]) }],
    });

    const result = await callGoogleAdsTool("list_campaign_performance", {});

    expect(result).toEqual([{ externalCampaignId: "111", spend: 40.5 }]);
    expect(callTool).toHaveBeenCalledWith({ name: "list_campaign_performance", arguments: {} });
  });

  it("throws when the tool result has isError set", async () => {
    callTool.mockResolvedValue({ isError: true, content: [{ type: "text", text: "INVALID_CUSTOMER_ID" }] });
    await expect(callGoogleAdsTool("pause_campaign", { campaignResourceName: "x" })).rejects.toThrow(/INVALID_CUSTOMER_ID/);
  });

  it("closes the connection even when callTool throws", async () => {
    callTool.mockRejectedValue(new Error("network error"));
    await expect(callGoogleAdsTool("pause_campaign", { campaignResourceName: "x" })).rejects.toThrow("network error");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not reject when client.close() aborts after a successful tool call", async () => {
    callTool.mockResolvedValue({ content: [{ type: "text", text: '{"ok":true}' }] });
    close.mockRejectedValue(new DOMException("This operation was aborted", "AbortError"));
    await expect(callGoogleAdsTool("pause_campaign", { campaignResourceName: "x" })).resolves.toEqual({ ok: true });
  });
});
