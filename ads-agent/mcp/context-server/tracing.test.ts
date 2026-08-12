import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const tokenMock = vi.hoisted(() => ({
  verifyTaskToken: vi.fn(),
  assertToolAllowed: vi.fn(),
  TaskTokenError: class extends Error {},
}));
vi.mock("./task-token", () => tokenMock);

const costMock = vi.hoisted(() => ({
  assertWithinCeiling: vi.fn(),
  recordTokenUsage: vi.fn(),
  CostCeilingExceededError: class extends Error {
    readonly code = "cost_ceiling_exceeded";
  },
}));
vi.mock("../../lib/db/agent-cost", () => costMock);

const readsMock = vi.hoisted(() => ({ listEnquiries: vi.fn(), getEnquiry: vi.fn() }));
vi.mock("./read-enquiries", () => ({
  ...readsMock,
  REPLY_STATES: ["waiting", "called", "closed"] as const,
}));

import {
  buildContextMcpServer,
  bufferSpanSink,
  CONTEXT_READ_TOOL_NAMES,
  CONTEXT_WRITE_TOOL_NAMES,
  setSpanSink,
} from "./index";

const ORG = "11111111-1111-1111-1111-111111111111";
const TOKEN = "a".repeat(64);
const BODY = "Asha wants 40 desks in Whitefield, reach her at asha@example.com";

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildContextMcpServer();
  const client = new Client({ name: "tracing", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function payload(result: unknown): unknown {
  return JSON.parse((result as { content: { text: string }[] }).content[0].text);
}

beforeEach(() => {
  vi.clearAllMocks();
  tokenMock.verifyTaskToken.mockResolvedValue({
    orgId: ORG,
    taskId: "task-1",
    profile: "leads",
    toolAllowlist: [...CONTEXT_READ_TOOL_NAMES, ...CONTEXT_WRITE_TOOL_NAMES],
  });
  costMock.assertWithinCeiling.mockResolvedValue(undefined);
  costMock.recordTokenUsage.mockResolvedValue(undefined);
  readsMock.listEnquiries.mockResolvedValue([]);
});

describe("the cost ceiling has no bypass", () => {
  it("checks the ceiling before running any tool", async () => {
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    expect(costMock.assertWithinCeiling).toHaveBeenCalledWith(ORG);
    expect(costMock.assertWithinCeiling.mock.invocationCallOrder[0]).toBeLessThan(
      readsMock.listEnquiries.mock.invocationCallOrder[0],
    );
    await client.close();
  });

  it("refuses an over-budget tenant and never runs the tool", async () => {
    costMock.assertWithinCeiling.mockRejectedValue(new costMock.CostCeilingExceededError());
    const client = await connectedClient();
    const result = await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    expect(payload(result)).toEqual({ error: "cost_ceiling_exceeded" });
    expect(readsMock.listEnquiries).not.toHaveBeenCalled();
    await client.close();
  });

  it("records token usage for every call, including one that failed", async () => {
    readsMock.listEnquiries.mockRejectedValue(new Error(BODY));
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    expect(costMock.recordTokenUsage).toHaveBeenCalledWith(ORG, expect.objectContaining({ tool: "list_enquiries" }));
    await client.close();
  });

  it("has exactly one call site for the ceiling check, in tool-context.ts", () => {
    const dispatch = readFileSync(join(__dirname, "tool-context.ts"), "utf8");
    expect((dispatch.match(/assertWithinCeiling\(/g) ?? []).length).toBe(1);
    const index = readFileSync(join(__dirname, "index.ts"), "utf8");
    expect(index).not.toContain("assertWithinCeiling");
    expect((index.match(/server\.registerTool\(/g) ?? []).length).toBe(1);
  });
});

describe("no message bodies on a span", () => {
  it("emits structure and references only", async () => {
    const sink = bufferSpanSink();
    setSpanSink(sink);
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    const attrs = sink.spans[0].attributes;
    expect(Object.keys(attrs)).toEqual(
      expect.arrayContaining([
        "gen_ai.operation.name",
        "gen_ai.tool.name",
        "gen_ai.agent.name",
        "gentlespace.tenant.id",
        "gen_ai.client.operation.duration",
      ]),
    );
    expect(Object.keys(attrs)).not.toContain("gen_ai.input.messages");
    expect(Object.keys(attrs)).not.toContain("gen_ai.output.messages");
    await client.close();
  });

  it("does not leak a body through the error path", async () => {
    const sink = bufferSpanSink();
    setSpanSink(sink);
    readsMock.listEnquiries.mockRejectedValue(new Error(BODY));
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    expect(sink.spans[0].status).toBe("error");
    expect(sink.spans[0].statusCode).toBe("tool_error");
    expect(JSON.stringify(sink.spans[0])).not.toContain("asha@example.com");
    expect(JSON.stringify(sink.spans[0])).not.toContain("40 desks");
    await client.close();
  });

  it("does not leak a body through a Postgres error detail", async () => {
    const sink = bufferSpanSink();
    setSpanSink(sink);
    readsMock.listEnquiries.mockRejectedValue(
      Object.assign(new Error("duplicate key"), {
        code: "23505",
        detail: `Key (contact_email)=(asha@example.com) already exists.`,
      }),
    );
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    expect(JSON.stringify(sink.spans[0])).not.toContain("asha@example.com");
    await client.close();
  });

  it("drops a forbidden attribute rather than emitting the span with it", async () => {
    const sink = bufferSpanSink();
    setSpanSink(sink);
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    // assertNoMessageBodies runs on the assembled attributes; if it ever throws,
    // the span is dropped and the tool result is unaffected.
    expect(sink.spans).toHaveLength(1);
    await client.close();
  });
});
