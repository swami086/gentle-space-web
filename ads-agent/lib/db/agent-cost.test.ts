import { beforeEach, describe, expect, it, vi } from "vitest";

const readQuery = vi.hoisted(() => vi.fn());
const writeQuery = vi.hoisted(() => vi.fn());
vi.mock("../../mcp/context-server/db", () => ({
  withAgentTenantTx: async (_o: string, fn: (tx: { query: typeof readQuery }) => Promise<unknown>) =>
    fn({ query: readQuery }),
  withAgentTenantWriteTx: async (_o: string, fn: (tx: { query: typeof writeQuery }) => Promise<unknown>) =>
    fn({ query: writeQuery }),
}));

import { assertWithinCeiling, CostCeilingExceededError, getTenantSpendTodayUsd, recordTokenUsage } from "./agent-cost";

const ORG = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  writeQuery.mockResolvedValue({ rows: [], rowCount: 1 });
});

describe("assertWithinCeiling", () => {
  it("permits a tenant under its ceiling", async () => {
    readQuery.mockResolvedValue({ rows: [{ spent_usd: "1.50", ceiling_usd: "5.00" }], rowCount: 1 });
    await expect(assertWithinCeiling(ORG)).resolves.toBeUndefined();
  });

  it("halts a tenant at or above its ceiling", async () => {
    readQuery.mockResolvedValue({ rows: [{ spent_usd: "5.00", ceiling_usd: "5.00" }], rowCount: 1 });
    await expect(assertWithinCeiling(ORG)).rejects.toBeInstanceOf(CostCeilingExceededError);
  });

  it("halts rather than permits when no ceiling row exists, so the control fails closed", async () => {
    readQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(assertWithinCeiling(ORG)).rejects.toMatchObject({ code: "cost_ceiling_exceeded" });
  });
});

describe("recordTokenUsage", () => {
  it("records through the SECURITY DEFINER function, never a direct INSERT", async () => {
    await recordTokenUsage(ORG, {
      profile: "leads",
      tool: "get_enquiry",
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.002,
    });
    const [sql, params] = writeQuery.mock.calls[0];
    expect(String(sql)).toContain("context.record_agent_token_usage");
    expect(String(sql)).not.toContain("INSERT");
    expect(params).toEqual(["leads", "get_enquiry", 100, 20, 0.002]);
  });

  it("rejects negative token counts rather than crediting a tenant", async () => {
    await expect(
      recordTokenUsage(ORG, { profile: "leads", tool: "t", inputTokens: -1, outputTokens: 0, costUsd: 0 }),
    ).rejects.toThrow("invalid_token_usage");
    expect(writeQuery).not.toHaveBeenCalled();
  });
});

describe("getTenantSpendTodayUsd", () => {
  it("returns numbers, not numeric strings", async () => {
    readQuery.mockResolvedValue({ rows: [{ spent_usd: "1.25", ceiling_usd: "5.00" }], rowCount: 1 });
    expect(await getTenantSpendTodayUsd(ORG)).toEqual({ spentUsd: 1.25, ceilingUsd: 5 });
  });
});
