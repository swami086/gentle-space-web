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

import { callTwentyTool, listTwentyTools } from "./mcp-client";

beforeEach(() => {
  connect.mockReset().mockResolvedValue(undefined);
  listTools.mockReset();
  callTool.mockReset();
  close.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listTwentyTools", () => {
  it("connects, lists tools, and closes the connection", async () => {
    listTools.mockResolvedValue({
      tools: [{ name: "list_opportunities", description: "List opportunities", inputSchema: { type: "object" } }],
    });

    const tools = await listTwentyTools();

    expect(tools).toEqual([{ name: "list_opportunities", description: "List opportunities", inputSchema: { type: "object" } }]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("still closes the connection when listTools throws", async () => {
    listTools.mockRejectedValue(new Error("boom"));
    await expect(listTwentyTools()).rejects.toThrow("boom");
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("callTwentyTool", () => {
  it("calls callTool with name/arguments and returns the parsed text content", async () => {
    callTool.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ records: [{ id: "1" }] }) }] });

    const result = await callTwentyTool("list_opportunities", { limit: 200 });

    expect(result).toEqual({ records: [{ id: "1" }] });
    expect(callTool).toHaveBeenCalledWith({ name: "list_opportunities", arguments: { limit: 200 } });
  });

  it("returns the raw text when it is not valid JSON", async () => {
    callTool.mockResolvedValue({ content: [{ type: "text", text: "plain text result" }] });
    expect(await callTwentyTool("some_tool", {})).toBe("plain text result");
  });

  it("parses JSON after a prose prefix (live Twenty MCP list_opportunities shape)", async () => {
    callTool.mockResolvedValue({
      content: [
        {
          type: "text",
          text: 'Found 2 opportunities (more available)\n\n[{"id":"1","name":"A"},{"id":"2","name":"B"}]',
        },
      ],
    });
    expect(await callTwentyTool("list_opportunities", { limit: 200 })).toEqual([
      { id: "1", name: "A" },
      { id: "2", name: "B" },
    ]);
  });

  it("does not reject when client.close() aborts after a successful tool call", async () => {
    callTool.mockResolvedValue({ content: [{ type: "text", text: '{"ok":true}' }] });
    close.mockRejectedValue(new DOMException("This operation was aborted", "AbortError"));
    await expect(callTwentyTool("list_opportunities", {})).resolves.toEqual({ ok: true });
  });

  it("throws when the tool result has isError set", async () => {
    callTool.mockResolvedValue({ isError: true, content: [{ type: "text", text: "bad stage" }] });
    await expect(callTwentyTool("update_opportunity", {})).rejects.toThrow(/bad stage/);
  });

  it("closes the connection even when callTool throws", async () => {
    callTool.mockRejectedValue(new Error("not found"));
    await expect(callTwentyTool("get_opportunity", { id: "missing" })).rejects.toThrow("not found");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
