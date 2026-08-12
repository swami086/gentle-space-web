import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG = "11111111-1111-1111-1111-111111111111";
const query = vi.fn();
vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));

const NOW = new Date("2026-08-12T12:00:00Z");
const OLD = new Date("2026-08-12T09:00:00Z"); // 3h before NOW
const YOUNG = new Date("2026-08-12T11:59:00Z"); // 1m before NOW

function listStore(objects: Array<{ key: string; lastModified: Date }>) {
  const removed: string[] = [];
  return {
    removed,
    list: async function* () {
      for (const o of objects) yield { ...o, byteSize: 1 };
    },
    remove: async (_b: string, k: string) => {
      removed.push(k);
    },
    head: vi.fn(),
    put: vi.fn(),
    get: vi.fn(),
  };
}

beforeEach(() => query.mockReset());

describe("orphanSweep", () => {
  it("deletes an object old enough to have no row", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("storage_key = $1")
        ? { rows: [], rowCount: 0 }
        : { rows: [], rowCount: 1 },
    );
    const store = listStore([{ key: "artifacts/x/draft/1", lastModified: OLD }]);

    const { orphanSweep } = await import("./sweeps");
    const out = await orphanSweep({ store: store as never, now: NOW });

    expect(out).toEqual({ scanned: 1, deleted: ["artifacts/x/draft/1"], skippedYoung: 0 });
    expect(store.removed).toEqual(["artifacts/x/draft/1"]);
  });

  it("spares a young orphan, because bytes are written before the row", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("storage_key = $1")
        ? { rows: [], rowCount: 0 }
        : { rows: [], rowCount: 1 },
    );
    const store = listStore([{ key: "artifacts/x/draft/2", lastModified: YOUNG }]);

    const { orphanSweep } = await import("./sweeps");
    const out = await orphanSweep({ store: store as never, now: NOW });

    expect(out).toEqual({ scanned: 1, deleted: [], skippedYoung: 1 });
    expect(store.removed).toEqual([]);
  });

  it("leaves a referenced object alone however old it is", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("storage_key = $1")
        ? { rows: [{ one: 1 }], rowCount: 1 }
        : { rows: [], rowCount: 1 },
    );
    const store = listStore([{ key: "artifacts/x/draft/3", lastModified: OLD }]);

    const { orphanSweep } = await import("./sweeps");
    const out = await orphanSweep({ store: store as never, now: NOW });
    expect(out.deleted).toEqual([]);
    expect(store.removed).toEqual([]);
  });

  it("defaults the grace window to an hour", async () => {
    const { ORPHAN_GRACE_SECONDS } = await import("./sweeps");
    expect(ORPHAN_GRACE_SECONDS).toBe(3600);
  });
});

describe("danglingSweep", () => {
  const store = { head: vi.fn(), list: vi.fn(), remove: vi.fn(), put: vi.fn(), get: vi.fn() };

  beforeEach(() => {
    store.head.mockReset();
    store.remove.mockReset();
  });

  it("classifies a row covered by an open deletion request as mid_erasure", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("open_request")
        ? {
            rows: [{ id: "a1", org_id: ORG, storage_key: "k1", open_request: true }],
            rowCount: 1,
          }
        : { rows: [], rowCount: 1 },
    );
    store.head.mockResolvedValue(null);

    const { danglingSweep } = await import("./sweeps");
    await expect(danglingSweep({ store: store as never })).resolves.toEqual([
      { artifactId: "a1", orgId: ORG, classification: "mid_erasure" },
    ]);
  });

  it("classifies an uncovered missing object as unexplained -- the case that alerts", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("open_request")
        ? {
            rows: [{ id: "a2", org_id: ORG, storage_key: "k2", open_request: false }],
            rowCount: 1,
          }
        : { rows: [], rowCount: 1 },
    );
    store.head.mockResolvedValue(null);

    const { danglingSweep } = await import("./sweeps");
    await expect(danglingSweep({ store: store as never })).resolves.toEqual([
      { artifactId: "a2", orgId: ORG, classification: "unexplained" },
    ]);
  });

  it("never deletes anything", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("open_request")
        ? {
            rows: [{ id: "a3", org_id: ORG, storage_key: "k3", open_request: false }],
            rowCount: 1,
          }
        : { rows: [], rowCount: 1 },
    );
    store.head.mockResolvedValue(null);

    const { danglingSweep } = await import("./sweeps");
    await danglingSweep({ store: store as never });
    expect(store.remove).not.toHaveBeenCalled();
  });

  it("flags nothing when the object is present", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("open_request")
        ? {
            rows: [{ id: "a4", org_id: ORG, storage_key: "k4", open_request: false }],
            rowCount: 1,
          }
        : { rows: [], rowCount: 1 },
    );
    store.head.mockResolvedValue({ key: "k4", byteSize: 1, lastModified: NOW });

    const { danglingSweep } = await import("./sweeps");
    await expect(danglingSweep({ store: store as never })).resolves.toEqual([]);
  });

  it("evaluates the classification with CASE, not OR", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("open_request")
        ? { rows: [], rowCount: 0 }
        : { rows: [], rowCount: 1 },
    );
    const { danglingSweep } = await import("./sweeps");
    await danglingSweep({ store: store as never });
    expect(String(query.mock.calls[0][0])).toContain(
      "CASE WHEN r.subject_kind = 'tenant' THEN true",
    );
  });
});
