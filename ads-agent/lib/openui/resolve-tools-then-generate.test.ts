// ads-agent/lib/openui/resolve-tools-then-generate.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callMeteredChatCompletion, listTwentyTools, callTwentyTool } = vi.hoisted(() => ({
  callMeteredChatCompletion: vi.fn(),
  listTwentyTools: vi.fn(),
  callTwentyTool: vi.fn(),
}));
vi.mock("../metering/metered-client", () => ({ callMeteredChatCompletion }));
vi.mock("../bifrost/mcp-client", () => ({ listTwentyTools, callTwentyTool }));

import { resolveToolsThenGenerate } from "./resolve-tools-then-generate";
import type { MeteringContext } from "../metering/types";

const ctx: MeteringContext = { orgId: "org-1", userId: "user-1", feature: "test" };
const baseMessages = [
  { role: "system" as const, content: "sys" },
  { role: "user" as const, content: "show me hot leads" },
];
const readOnlySchemas = [
  { name: "list_opportunities", description: "List opportunities", inputSchema: { type: "object" } },
  { name: "get_opportunity", description: "Get one opportunity", inputSchema: { type: "object" } },
];

beforeEach(() => {
  callMeteredChatCompletion.mockReset();
  listTwentyTools.mockReset().mockResolvedValue([
    ...readOnlySchemas,
    { name: "update_opportunity", description: "Update", inputSchema: { type: "object" } },
  ]);
  callTwentyTool.mockReset();
});

describe("resolveToolsThenGenerate", () => {
  it("returns the original messages unchanged when the model requests no tools", async () => {
    callMeteredChatCompletion.mockResolvedValue({
      choices: [{ message: { role: "assistant", content: "no tools needed" } }],
    });

    const result = await resolveToolsThenGenerate(ctx, baseMessages);

    expect(result).toEqual(baseMessages);
    expect(callTwentyTool).not.toHaveBeenCalled();
    const [, options] = callMeteredChatCompletion.mock.calls[0];
    expect(options.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual([
      "list_opportunities",
      "get_opportunity",
    ]);
  });

  it("executes a read tool call and appends the assistant + tool messages", async () => {
    const toolCall = { id: "call_1", type: "function" as const, function: { name: "list_opportunities", arguments: "{}" } };
    callMeteredChatCompletion
      .mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: null, tool_calls: [toolCall] } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: "done" } }] } as never);
    callTwentyTool.mockResolvedValue([{ id: "1" }]);

    const result = await resolveToolsThenGenerate(ctx, baseMessages);

    expect(result).toEqual([
      ...baseMessages,
      { role: "assistant", content: null, tool_calls: [toolCall] },
      { role: "tool", content: JSON.stringify([{ id: "1" }]), tool_call_id: "call_1" },
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

    const result = await resolveToolsThenGenerate(ctx, baseMessages);

    expect(result).toHaveLength(baseMessages.length + 3);
    expect(callTwentyTool).toHaveBeenCalledTimes(2);
  });

  it("rejects any tool-call name outside the two advertised read tools, and stops the loop", async () => {
    const mutatingCall = { id: "call_1", type: "function" as const, function: { name: "update_opportunity", arguments: '{"id":"1","stage":"TOUR"}' } };
    callMeteredChatCompletion.mockResolvedValue({ choices: [{ message: { role: "assistant", content: null, tool_calls: [mutatingCall] } }] } as never);

    const result = await resolveToolsThenGenerate(ctx, baseMessages);

    expect(callTwentyTool).not.toHaveBeenCalled();
    expect(result).toEqual(baseMessages);
  });

  it("stops after 2 rounds even if the model keeps requesting tools", async () => {
    const toolCall = { id: "call_1", type: "function" as const, function: { name: "list_opportunities", arguments: "{}" } };
    callMeteredChatCompletion.mockResolvedValue({ choices: [{ message: { role: "assistant", content: null, tool_calls: [toolCall] } }] } as never);
    callTwentyTool.mockResolvedValue([]);

    await resolveToolsThenGenerate(ctx, baseMessages);

    expect(callMeteredChatCompletion).toHaveBeenCalledTimes(2);
    expect(callTwentyTool).toHaveBeenCalledTimes(2);
  });

  it("returns the original messages unchanged when listing live tool schemas throws", async () => {
    listTwentyTools.mockRejectedValue(new Error("twenty-mcp-gateway unreachable"));
    const result = await resolveToolsThenGenerate(ctx, baseMessages);
    expect(result).toEqual(baseMessages);
    expect(callMeteredChatCompletion).not.toHaveBeenCalled();
  });

  it("returns the original messages unchanged when the resolve call itself throws", async () => {
    callMeteredChatCompletion.mockRejectedValue(new Error("bifrost unreachable"));
    const result = await resolveToolsThenGenerate(ctx, baseMessages);
    expect(result).toEqual(baseMessages);
  });
});
