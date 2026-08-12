import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Scope } from "../db/scope-sql";

const ORG = "11111111-1111-1111-1111-111111111111";
const scope = { kind: "org", orgId: ORG } as Scope;

const query = vi.fn();
const createBucket = vi.fn();
const getBucketByAlias = vi.fn();
const createKey = vi.fn();
const allowBucketKey = vi.fn();

vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));
vi.mock("../db/scope-sql", () => ({
  scopeClause: () => ({ sql: "org_id = $1", params: [ORG] }),
}));
vi.mock("../objectstore/garage-admin", () => ({
  garageAdminFromEnv: () => ({ endpoint: "http://127.0.0.1:3903", token: "T" }),
  createBucket,
  getBucketByAlias,
  createKey,
  allowBucketKey,
  deleteBucket: vi.fn(),
}));

beforeEach(() => {
  process.env.SNAPSHOT_MASTER_KEY = "a".repeat(64);
  process.env.ARTIFACT_ACCESS_KEY_ID = "GKserver";
  process.env.GARAGE_S3_ENDPOINT = "http://127.0.0.1:3900";
  query.mockReset();
  createBucket.mockReset();
  getBucketByAlias.mockReset();
  createKey.mockReset();
  allowBucketKey.mockReset();
});

describe("snapshotBucketName", () => {
  it("is one bucket per tenant, because Garage grants per bucket not per prefix", async () => {
    const { snapshotBucketName } = await import("./snapshot-iam");
    expect(snapshotBucketName(ORG)).toBe(`gs-snap-${ORG}`);
    expect(snapshotBucketName(ORG).length).toBeLessThanOrEqual(63);
  });
});

describe("provisionSnapshotStorage", () => {
  it("grants the tenant reader read-only and the server key write", async () => {
    getBucketByAlias.mockResolvedValue(null);
    createBucket.mockResolvedValue({ id: "b1" });
    createKey.mockResolvedValue({ accessKeyId: "GKtenant", secretAccessKey: "Stenant" });
    query.mockResolvedValue({ rows: [], rowCount: 1 });

    const { provisionSnapshotStorage } = await import("./snapshot-iam");
    await expect(provisionSnapshotStorage(scope)).resolves.toEqual({
      bucket: `gs-snap-${ORG}`,
      readerAccessKeyId: "GKtenant",
    });

    expect(allowBucketKey).toHaveBeenCalledWith(
      expect.anything(),
      "b1",
      "GKtenant",
      { read: true, write: false, owner: false },
    );
    expect(allowBucketKey).toHaveBeenCalledWith(
      expect.anything(),
      "b1",
      "GKserver",
      { read: true, write: true, owner: false },
    );
  });

  it("persists the reader secret sealed, never in plaintext", async () => {
    getBucketByAlias.mockResolvedValue({ id: "b1" });
    createKey.mockResolvedValue({ accessKeyId: "GKtenant", secretAccessKey: "Stenant" });
    query.mockResolvedValue({ rows: [], rowCount: 1 });

    const { provisionSnapshotStorage } = await import("./snapshot-iam");
    await provisionSnapshotStorage(scope);

    const params = query.mock.calls.at(-1)![1] as unknown[];
    expect(params.some((p) => p === "Stenant")).toBe(false);
    expect(params.some((p) => Buffer.isBuffer(p))).toBe(true);
  });

  it("is idempotent when the bucket already exists", async () => {
    getBucketByAlias.mockResolvedValue({ id: "b1" });
    createKey.mockResolvedValue({ accessKeyId: "GK", secretAccessKey: "S" });
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    const { provisionSnapshotStorage } = await import("./snapshot-iam");
    await provisionSnapshotStorage(scope);
    expect(createBucket).not.toHaveBeenCalled();
  });

  it("never rotates an existing data key, which would orphan every snapshot", async () => {
    getBucketByAlias.mockResolvedValue({ id: "b1" });
    createKey.mockResolvedValue({ accessKeyId: "GK", secretAccessKey: "S" });
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    const { provisionSnapshotStorage } = await import("./snapshot-iam");
    await provisionSnapshotStorage(scope);
    expect(String(query.mock.calls.at(-1)![0])).toContain(
      "COALESCE(context.snapshot_storage.data_key_sealed",
    );
  });
});

describe("tenantDataKey", () => {
  it("throws once the key has been destroyed, which is the erasure", async () => {
    query.mockResolvedValue({
      rows: [{ data_key_sealed: null, key_destroyed_at: new Date() }],
      rowCount: 1,
    });
    const { tenantDataKey } = await import("./snapshot-iam");
    await expect(tenantDataKey(scope)).rejects.toThrow(/destroyed/);
  });
});

describe("destroyTenantSnapshotKey", () => {
  it("nulls the sealed key and stamps the destruction time", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    const { destroyTenantSnapshotKey } = await import("./snapshot-iam");
    await destroyTenantSnapshotKey(scope);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("data_key_sealed = NULL");
    expect(sql).toContain("key_destroyed_at = now()");
  });
});
