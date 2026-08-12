import { beforeEach, describe, expect, it, vi } from "vitest";

const agentQuery = vi.hoisted(() => vi.fn());
const ownerQuery = vi.hoisted(() => vi.fn());
const agentClient = vi.hoisted(() => ({ query: agentQuery, release: vi.fn() }));

vi.mock("./db", () => ({
  getAgentReadPool: () => ({ connect: async () => agentClient, query: agentQuery }),
}));
vi.mock("../../lib/db/client", () => ({
  getPool: () => ({ connect: async () => ({ query: ownerQuery, release: vi.fn() }), query: ownerQuery }),
}));

import {
  assertToolAllowed,
  mintTaskToken,
  revokeTaskToken,
  TaskTokenError,
  verifyTaskToken,
} from "./task-token";

const ORG_A = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  agentQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  ownerQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("mintTaskToken", () => {
  it("returns a 64-hex-character token and stores only its sha256, never the token", async () => {
    const { token } = await mintTaskToken({
      orgId: ORG_A,
      taskId: "task-1",
      profile: "leads",
      toolAllowlist: ["get_enquiry"],
      ttlSeconds: 600,
    });
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const insert = ownerQuery.mock.calls.find((c) => String(c[0]).includes("INSERT INTO context.agent_task_tokens"));
    expect(insert, "expected an insert into context.agent_task_tokens").toBeDefined();
    const params = insert![1] as unknown[];
    expect(params).not.toContain(token);
    expect(params.some((p) => Buffer.isBuffer(p))).toBe(true);
  });
});

describe("verifyTaskToken", () => {
  it("derives the tenant from the token via the verifier function", async () => {
    agentQuery.mockImplementation(async (sql: string) =>
      String(sql).includes("verify_agent_task_token")
        ? {
            rows: [
              { org_id: ORG_A, task_id: "task-1", profile: "leads", tool_allowlist: ["get_enquiry"] },
            ],
            rowCount: 1,
          }
        : { rows: [], rowCount: 0 },
    );
    const claims = await verifyTaskToken("a".repeat(64));
    expect(claims).toEqual({
      orgId: ORG_A,
      taskId: "task-1",
      profile: "leads",
      toolAllowlist: ["get_enquiry"],
    });
  });

  it("rejects an unknown, revoked or expired token with code token_invalid", async () => {
    await expect(verifyTaskToken("b".repeat(64))).rejects.toMatchObject({ code: "token_invalid" });
  });

  it("never puts the token into the error message", async () => {
    const token = "c".repeat(64);
    const err = await verifyTaskToken(token).catch((e: unknown) => e as TaskTokenError);
    expect(String(err)).not.toContain(token);
  });

  it("rejects a malformed token before it reaches the database", async () => {
    await expect(verifyTaskToken("not-a-token")).rejects.toMatchObject({ code: "token_invalid" });
    expect(agentQuery).not.toHaveBeenCalled();
  });
});

describe("assertToolAllowed", () => {
  const claims = { orgId: ORG_A, taskId: "t", profile: "leads", toolAllowlist: ["get_enquiry"] };

  it("permits a tool named in the token", () => {
    expect(() => assertToolAllowed(claims, "get_enquiry")).not.toThrow();
  });

  it("refuses a tool the profile was not granted, so a TTL is not a licence to call anything", () => {
    expect(() => assertToolAllowed(claims, "create_proposal")).toThrow(TaskTokenError);
  });
});

describe("revokeTaskToken", () => {
  it("revokes by suppression column rather than DELETE", async () => {
    await revokeTaskToken(ORG_A, "task-1");
    const sql = ownerQuery.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toContain("SET revoked_at");
    expect(sql).not.toContain("DELETE");
  });
});
