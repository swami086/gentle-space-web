import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mintTaskToken } = vi.hoisted(() => ({
  mintTaskToken: vi.fn(),
}));

vi.mock("@/mcp/context-server/task-token", () => ({ mintTaskToken }));

import { POST } from "./route";
import { LEADS_TOOL_ALLOWLIST } from "@/lib/agent/leads-tools";
import { ORCHESTRATOR_TOOL_ALLOWLIST } from "@/lib/agent/orchestrator-tools";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const KEY = "test-agent-internal-key";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/internal/agent/task-token", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/internal/agent/task-token", () => {
  beforeEach(() => {
    process.env.AGENT_INTERNAL_API_KEY = KEY;
    mintTaskToken.mockReset();
    mintTaskToken.mockResolvedValue({ token: "ab".repeat(32) });
  });
  afterEach(() => {
    delete process.env.AGENT_INTERNAL_API_KEY;
  });

  it("returns 401 without key", async () => {
    const res = await post({ orgId: ORG, taskId: "t1", profile: "leads" });
    expect(res.status).toBe(401);
    expect(mintTaskToken).not.toHaveBeenCalled();
  });

  it("returns 401 with wrong key", async () => {
    const res = await post(
      { orgId: ORG, taskId: "t1", profile: "leads" },
      { "x-agent-internal-key": "nope" },
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 forbidden_profile for unknown profile", async () => {
    const res = await post(
      { orgId: ORG, taskId: "t1", profile: "campaign" },
      { "x-agent-internal-key": KEY },
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "forbidden_profile" });
    expect(mintTaskToken).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid orgId", async () => {
    const res = await post(
      { orgId: "not-a-uuid", taskId: "t1", profile: "leads" },
      { "x-agent-internal-key": KEY },
    );
    expect(res.status).toBe(400);
  });

  it("mints for orchestrator with server allowlist", async () => {
    const res = await post(
      { orgId: ORG, taskId: "task-99", profile: "orchestrator", ttlSeconds: 300 },
      { "x-agent-internal-key": KEY },
    );
    expect(res.status).toBe(200);
    expect(mintTaskToken).toHaveBeenCalledWith({
      orgId: ORG,
      taskId: "task-99",
      profile: "orchestrator",
      toolAllowlist: [...ORCHESTRATOR_TOOL_ALLOWLIST],
      ttlSeconds: 300,
    });
    expect(mintTaskToken.mock.calls[0][0].toolAllowlist).toContain("list_proposals");
    expect(mintTaskToken.mock.calls[0][0].toolAllowlist).not.toContain("create_proposal");
  });

  it("mints with server-owned allowlist", async () => {
    const res = await post(
      { orgId: ORG, taskId: "task-42", profile: "leads", ttlSeconds: 120 },
      { "x-agent-internal-key": KEY },
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ token: "ab".repeat(32) });
    expect(mintTaskToken).toHaveBeenCalledWith({
      orgId: ORG,
      taskId: "task-42",
      profile: "leads",
      toolAllowlist: [...LEADS_TOOL_ALLOWLIST],
      ttlSeconds: 120,
    });
  });

  it("ignores client toolAllowlist if somehow present", async () => {
    await post(
      {
        orgId: ORG,
        taskId: "t1",
        profile: "leads",
        toolAllowlist: ["get_campaign_performance"],
      },
      { "x-agent-internal-key": KEY },
    );
    expect(mintTaskToken.mock.calls[0][0].toolAllowlist).toEqual([...LEADS_TOOL_ALLOWLIST]);
    expect(mintTaskToken.mock.calls[0][0].toolAllowlist).not.toContain("get_campaign_performance");
  });
});
