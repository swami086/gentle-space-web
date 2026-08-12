import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
const clientQuery = vi.fn();
const release = vi.fn();
const enqueueEvent = vi.fn().mockResolvedValue("evt");

vi.mock("../db/client", () => ({
  getPool: () => ({
    query,
    connect: async () => ({ query: clientQuery, release }),
  }),
}));
vi.mock("../db/outbox", () => ({ enqueueEvent }));
vi.mock("../db/tx", () => ({
  withTenantTransaction: async (
    _scope: unknown,
    fn: (client: { query: typeof clientQuery }) => Promise<unknown>,
  ) => fn({ query: clientQuery }),
}));

const ORG = "11111111-1111-1111-1111-111111111111";
const SNAP = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeEach(() => {
  query.mockReset();
  clientQuery.mockReset();
  release.mockReset();
  enqueueEvent.mockClear();
});

describe("markTenantStale", () => {
  it("coalesces stale_since so a bulk import cannot push the clock forward", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const { markTenantStale } = await import("./backpressure");
    await markTenantStale({ kind: "org", orgId: ORG }, { byUser: true });

    const sql = clientQuery.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toContain("COALESCE(context.graph_manifests.stale_since, now())");
  });

  it("enqueues graph.tenant_stale on the same client as the manifest write", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const { markTenantStale } = await import("./backpressure");
    await markTenantStale({ kind: "org", orgId: ORG }, { byUser: false });

    expect(enqueueEvent).toHaveBeenCalledWith(
      { kind: "org", orgId: ORG },
      expect.objectContaining({ query: clientQuery }),
      { topic: "graph.tenant_stale", payload: { byUser: false } },
    );
  });
});

describe("claimRebuild", () => {
  it("claims a slot and a manifest row with FOR UPDATE SKIP LOCKED", async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ slot_no: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ org_id: ORG, building_id: SNAP, generation: "7" }],
        rowCount: 1,
      })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const { claimRebuild } = await import("./backpressure");
    await expect(claimRebuild()).resolves.toEqual({
      orgId: ORG,
      slotNo: 1,
      snapshotId: SNAP,
      generation: 7,
    });

    const sql = clientQuery.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql.match(/FOR UPDATE SKIP LOCKED/g)).toHaveLength(2);
  });

  it("returns null and takes no slot when every slot is leased", async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { claimRebuild } = await import("./backpressure");
    await expect(claimRebuild()).resolves.toBeNull();
    expect(clientQuery.mock.calls.some((c) => String(c[0]).includes("ROLLBACK"))).toBe(true);
  });

  it("releases the slot when a slot was free but no tenant was due", async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ slot_no: 2 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValue({ rows: [], rowCount: 1 });
    const { claimRebuild } = await import("./backpressure");
    await expect(claimRebuild()).resolves.toBeNull();

    const sql = clientQuery.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toContain("SET org_id = NULL, leased_until = NULL");
  });

  it("filters by the debounce window and orders by recent user activity", async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ slot_no: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValue({ rows: [], rowCount: 1 });
    const { claimRebuild, REBUILD_DEBOUNCE_SECONDS } = await import("./backpressure");
    await claimRebuild();

    const manifestCall = clientQuery.mock.calls.find((c) =>
      String(c[0]).includes("context.graph_manifests m"),
    );
    expect(String(manifestCall![0])).toContain(
      "stale_since <= now() - ($1 || ' seconds')::interval",
    );
    expect(String(manifestCall![0])).toContain(
      "ORDER BY (last_user_activity_at >= now() - interval '1 day') DESC NULLS LAST",
    );
    expect(manifestCall![1]).toEqual([String(REBUILD_DEBOUNCE_SECONDS)]);
    expect(REBUILD_DEBOUNCE_SECONDS).toBe(300);
  });
});

describe("finishRebuild", () => {
  it("clears staleness, records lag, and frees the slot", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const { finishRebuild } = await import("./backpressure");
    await finishRebuild(
      { orgId: ORG, slotNo: 1, snapshotId: SNAP, generation: 7 },
      { sourceWatermark: new Date("2026-08-12T08:00:00Z"), cdcLagSeconds: 12 },
    );
    const sql = clientQuery.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toContain("status = 'ready'");
    expect(sql).toContain("stale_since = NULL");
    expect(sql).toContain("cdc_lag_seconds");
    expect(sql).toContain("SET org_id = NULL, leased_until = NULL");
  });
});

describe("failRebuild", () => {
  it("records the error and frees the slot, so a failure cannot hold the ceiling", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const { failRebuild } = await import("./backpressure");
    await failRebuild(
      { orgId: ORG, slotNo: 2, snapshotId: SNAP, generation: 7 },
      "clickhouse unreachable",
    );
    const sql = clientQuery.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toContain("status = 'error'");
    expect(sql).toContain("SET org_id = NULL, leased_until = NULL");
  });
});
