import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const tokenMock = vi.hoisted(() => ({
  verifyTaskToken: vi.fn(),
  assertToolAllowed: vi.fn(),
  TaskTokenError: class extends Error {
    constructor(public code: string) {
      super(code);
    }
  },
}));
vi.mock("./task-token", () => tokenMock);

const readsMock = vi.hoisted(() => ({
  listEnquiries: vi.fn(),
  getEnquiry: vi.fn(),
  REPLY_STATES: ["waiting", "called", "closed"] as const,
}));
vi.mock("./read-enquiries", () => readsMock);

const writeMock = vi.hoisted(() => ({
  createAgentProposal: vi.fn(),
  AGENT_PROPOSAL_KINDS: ["enquiry.requirement_update"] as const,
  SPEND_CHANGING_KINDS: [] as const,
  STALE_LAG_SECONDS: 900,
  CreateProposalError: class extends Error {},
}));
vi.mock("./create-proposal", () => writeMock);

import {
  buildContextMcpServer,
  bufferSpanSink,
  CONTEXT_READ_TOOL_NAMES,
  CONTEXT_WRITE_TOOL_NAMES,
  setSpanSink,
} from "./index";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const TOKEN = "a".repeat(64);

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildContextMcpServer();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  tokenMock.verifyTaskToken.mockResolvedValue({
    orgId: ORG_A,
    taskId: "task-1",
    profile: "leads",
    toolAllowlist: [...CONTEXT_READ_TOOL_NAMES, ...CONTEXT_WRITE_TOOL_NAMES],
  });
});

describe("buildContextMcpServer", () => {
  it("registers exactly 8 read tools and exactly 1 write tool", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [...CONTEXT_READ_TOOL_NAMES, ...CONTEXT_WRITE_TOOL_NAMES].sort(),
    );
    expect(CONTEXT_READ_TOOL_NAMES).toHaveLength(8);
    expect(CONTEXT_WRITE_TOOL_NAMES).toEqual(["create_proposal"]);
    await client.close();
  });

  it("exposes create_proposal as the only write tool", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const writes = tools.filter((t) => !CONTEXT_READ_TOOL_NAMES.includes(t.name as never));
    expect(writes.map((t) => t.name)).toEqual(["create_proposal"]);
    await client.close();
  });

  it("no tool accepts an org_id: the tenant is never nameable by the caller", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const keys = Object.keys(
        (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
      );
      expect(keys, `${tool.name} must not take a tenant`).not.toContain("org_id");
      expect(keys, `${tool.name} must not take a tenant`).not.toContain("orgId");
      expect(keys, `${tool.name} must require a task_token`).toContain("task_token");
    }
    await client.close();
  });

  it("no tool accepts query text", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const keys = Object.keys(
        (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
      );
      for (const banned of ["cypher", "sql", "query_text", "statement"]) {
        expect(keys, `${tool.name} must not take ${banned}`).not.toContain(banned);
      }
    }
    await client.close();
  });

  it("verifies the token and derives the tenant before running a tool", async () => {
    readsMock.listEnquiries.mockResolvedValue([]);
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    expect(tokenMock.verifyTaskToken).toHaveBeenCalledWith(TOKEN);
    expect(readsMock.listEnquiries.mock.calls[0][0]).toMatchObject({ orgId: ORG_A });
    await client.close();
  });

  it("emits one span per tool call, carrying the profile, tool and tenant", async () => {
    const sink = bufferSpanSink();
    setSpanSink(sink);
    readsMock.listEnquiries.mockResolvedValue([]);
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    expect(sink.spans).toHaveLength(1);
    expect(sink.spans[0].attributes["gen_ai.agent.name"]).toBe("leads");
    expect(sink.spans[0].attributes["gen_ai.tool.name"]).toBe("list_enquiries");
    expect(sink.spans[0].attributes["gentlespace.tenant.id"]).toBe(ORG_A);
    await client.close();
  });

  it("emits a span on the error path too, with a code and no exception message", async () => {
    const sink = bufferSpanSink();
    setSpanSink(sink);
    readsMock.listEnquiries.mockRejectedValue(new Error("Asha asked for 40 desks, asha@example.com"));
    const client = await connectedClient();
    await client.callTool({ name: "list_enquiries", arguments: { task_token: TOKEN } });
    expect(sink.spans).toHaveLength(1);
    expect(sink.spans[0].status).toBe("error");
    expect(JSON.stringify(sink.spans[0])).not.toContain("asha@example.com");
    await client.close();
  });

  it("returns not-found rather than a denial when get_enquiry yields null", async () => {
    readsMock.getEnquiry.mockResolvedValue(null);
    const client = await connectedClient();
    const result = await client.callTool({
      name: "get_enquiry",
      arguments: { task_token: TOKEN, enquiry_id: "33333333-3333-3333-3333-333333333333" },
    });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual({ error: "not_found" });
    await client.close();
  });
});

describe("single dispatch path", () => {
  it("registers every tool through registerGuardedTool and calls server.registerTool exactly once", () => {
    const src = readFileSync(join(__dirname, "index.ts"), "utf8");
    const direct = src.match(/server\.registerTool\(/g) ?? [];
    expect(direct, "server.registerTool must appear only inside registerGuardedTool").toHaveLength(1);
    const guarded = src.match(/registerGuardedTool\(/g) ?? [];
    // one definition + one call per tool (8 read + 1 write)
    expect(guarded.length).toBe(10);
  });
});
