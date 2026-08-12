import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Scope } from "../db/scope-sql";

const ORG = "11111111-1111-1111-1111-111111111111";
const SNAP = "22222222-2222-2222-2222-222222222222";
const scope = { kind: "org", orgId: ORG } as Scope;

const query = vi.fn();
vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));
vi.mock("../db/scope-sql", () => ({
  scopeClause: () => ({ sql: "org_id = $1", params: [ORG] }),
}));

const removed: string[] = [];
const store = {
  remove: async (_bucket: string, key: string) => {
    removed.push(key);
  },
  put: vi.fn(),
  get: vi.fn(),
  head: vi.fn(),
  list: vi.fn(),
};

beforeEach(() => {
  query.mockReset();
  removed.length = 0;
});

describe("recordSnapshot", () => {
  it("stores the TTL as an interval and upserts on (org_id, snapshot_id)", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    const { recordSnapshot, SNAPSHOT_TTL_SECONDS } = await import("./snapshot-lease");
    await recordSnapshot(scope, {
      orgId: ORG,
      snapshotId: SNAP,
      generation: 3,
      bucket: "gs-snap",
      storageKey: "s.duckdb.enc",
      byteSize: 10,
      checksum: "c",
      sourceWatermark: new Date(),
      cdcLagSeconds: 4,
    });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("ON CONFLICT (org_id, snapshot_id)");
    expect(sql).toContain("now() + ($8 || ' seconds')::interval");
    expect(query.mock.calls[0][1]).toContain(String(SNAPSHOT_TTL_SECONDS));
  });
});

describe("takeLease", () => {
  it("returns a lease id with an expiry", async () => {
    query.mockResolvedValue({ rows: [{ id: "lease-1" }], rowCount: 1 });
    const { takeLease, SNAPSHOT_LEASE_SECONDS } = await import("./snapshot-lease");
    await expect(takeLease(scope, SNAP, "web-1")).resolves.toBe("lease-1");
    expect(String(query.mock.calls[0][0])).toContain("expires_at");
    expect(query.mock.calls[0][1]).toContain(String(SNAPSHOT_LEASE_SECONDS));
  });
});

describe("collectSnapshots", () => {
  it("collects generations past the keep count and deletes their bytes", async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "r1",
            org_id: ORG,
            snapshot_id: SNAP,
            bucket: "gs-snap",
            storage_key: "old.duckdb.enc",
            is_current: false,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ blocked: "0" }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const { collectSnapshots, SNAPSHOT_GENERATIONS_KEPT } = await import("./snapshot-lease");
    const out = await collectSnapshots(store as never);

    expect(SNAPSHOT_GENERATIONS_KEPT).toBe(2);
    expect(removed).toEqual(["old.duckdb.enc"]);
    expect(out.collected).toHaveLength(1);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("row_number() OVER (PARTITION BY");
    expect(sql).toContain("expires_at < now()");
    expect(sql).toContain("NOT EXISTS");
  });

  it("re-marks the tenant stale when the CURRENT generation expired", async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "r1",
            org_id: ORG,
            snapshot_id: SNAP,
            bucket: "gs-snap",
            storage_key: "cur.duckdb.enc",
            is_current: true,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ blocked: "0" }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const { collectSnapshots } = await import("./snapshot-lease");
    const out = await collectSnapshots(store as never);

    expect(out.currentGenerationExpired).toEqual([ORG]);
    const sql = query.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("snapshot_id = NULL");
  });

  it("counts snapshots a live lease is holding rather than deleting them", async () => {
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ blocked: "3" }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { collectSnapshots } = await import("./snapshot-lease");
    const out = await collectSnapshots(store as never);
    expect(out.blockedByLease).toBe(3);
    expect(removed).toEqual([]);
  });
});
