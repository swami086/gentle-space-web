// ads-agent/mcp/context-server/context-pack.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const txQuery = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({
  withAgentTenantTx: async (_o: string, fn: (tx: { query: typeof txQuery }) => Promise<unknown>) =>
    fn({ query: txQuery }),
}));

import { getContextPack } from "./context-pack";

const CLAIMS = {
  orgId: "11111111-1111-1111-1111-111111111111",
  taskId: "task-1",
  profile: "leads",
  toolAllowlist: ["get_context_pack"],
};
const ENQ = "33333333-3333-3333-3333-333333333333";
const BUILT_AT = new Date("2026-08-12T08:00:00.000Z");

function manifest(lag: number | null) {
  return { rows: [{ built_at: BUILT_AT, cdc_lag_seconds: lag }], rowCount: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getContextPack", () => {
  it("carries built_at and the CDC lag alongside the facts", async () => {
    txQuery
      .mockResolvedValueOnce(manifest(30))
      .mockResolvedValueOnce({ rows: [{ id: ENQ, contact_name: "Asha", reply_state: "waiting" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: "a1", kind: "call", occurred_at: BUILT_AT }], rowCount: 1 });
    const pack = await getContextPack(CLAIMS, { entity: "enquiry", id: ENQ });
    expect(pack?.builtAt).toBe("2026-08-12T08:00:00.000Z");
    expect(pack?.cdcLagSeconds).toBe(30);
    expect(pack?.stale).toBe(false);
  });

  it("marks the pack stale above the 15-minute threshold", async () => {
    txQuery
      .mockResolvedValueOnce(manifest(1200))
      .mockResolvedValueOnce({ rows: [{ id: ENQ, contact_name: "Asha", reply_state: "waiting" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const pack = await getContextPack(CLAIMS, { entity: "enquiry", id: ENQ });
    expect(pack?.stale).toBe(true);
  });

  it("treats an unknown lag as stale, so unknown never reads as fresh", async () => {
    txQuery
      .mockResolvedValueOnce(manifest(null))
      .mockResolvedValueOnce({ rows: [{ id: ENQ, contact_name: "Asha", reply_state: "waiting" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const pack = await getContextPack(CLAIMS, { entity: "enquiry", id: ENQ });
    expect(pack?.cdcLagSeconds).toBeNull();
    expect(pack?.stale).toBe(true);
  });

  it("lists every row id it drew on, so a claim outside the pack is detectably invented", async () => {
    txQuery
      .mockResolvedValueOnce(manifest(30))
      .mockResolvedValueOnce({ rows: [{ id: ENQ, contact_name: "Asha", reply_state: "waiting" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: "a1", kind: "call", occurred_at: BUILT_AT }], rowCount: 1 });
    const pack = await getContextPack(CLAIMS, { entity: "enquiry", id: ENQ });
    expect(pack?.rowIds).toEqual([ENQ, "a1"]);
  });

  it("returns null for another tenant's id", async () => {
    txQuery.mockResolvedValueOnce(manifest(30)).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await getContextPack(CLAIMS, { entity: "enquiry", id: ENQ })).toBeNull();
  });

  it("rejects an unknown entity kind", async () => {
    // @ts-expect-error deliberately invalid at the type level too
    await expect(getContextPack(CLAIMS, { entity: "person", id: ENQ })).rejects.toThrow("invalid_entity");
    expect(txQuery).not.toHaveBeenCalled();
  });
});
