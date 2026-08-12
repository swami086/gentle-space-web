// ads-agent/mcp/context-server/read-proposals.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const txQuery = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({
  withAgentTenantTx: async (_orgId: string, fn: (tx: { query: typeof txQuery }) => Promise<unknown>) =>
    fn({ query: txQuery }),
}));

import { listProposals } from "./read-proposals";

const CLAIMS = {
  orgId: "11111111-1111-1111-1111-111111111111",
  taskId: "task-1",
  profile: "leads",
  toolAllowlist: ["list_proposals"],
};

beforeEach(() => {
  vi.clearAllMocks();
  txQuery.mockResolvedValue({
    rows: [
      {
        id: "55555555-5555-5555-5555-555555555555",
        kind: "enquiry.requirement_update",
        status: "pending",
        rationale: "Asked about pricing twice",
        evidence: ["33333333-3333-3333-3333-333333333333"],
        created_at: new Date("2026-08-11T10:00:00.000Z"),
        decided_at: null,
      },
    ],
    rowCount: 1,
  });
});

describe("listProposals", () => {
  it("reads the tenant-scoped view and binds the status filter", async () => {
    await listProposals(CLAIMS, { status: "pending" });
    const [sql, params] = txQuery.mock.calls[0];
    expect(String(sql)).toContain("context.v_agent_proposals");
    expect(String(sql)).not.toContain("adsagent.proposals");
    expect(params).toContain("pending");
  });

  it("returns evidence as a string array even when the column is JSONB", async () => {
    const [row] = await listProposals(CLAIMS, {});
    expect(row.evidence).toEqual(["33333333-3333-3333-3333-333333333333"]);
    expect(row.createdAt).toBe("2026-08-11T10:00:00.000Z");
    expect(row.decidedAt).toBeNull();
  });

  it("rejects an unknown status rather than silently listing everything", async () => {
    // @ts-expect-error deliberately invalid at the type level too
    await expect(listProposals(CLAIMS, { status: "executed" })).rejects.toThrow("invalid_status");
    expect(txQuery).not.toHaveBeenCalled();
  });
});
