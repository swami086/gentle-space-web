import { describe, it, expect, vi, afterEach } from "vitest";
import {
  allowBucketKey,
  createBucket,
  createKey,
  deleteBucket,
  getBucketByAlias,
  type GarageAdmin,
} from "./garage-admin";

const admin: GarageAdmin = { endpoint: "http://127.0.0.1:3903", token: "T" };
const ok = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(body) });

afterEach(() => vi.unstubAllGlobals());

describe("garage admin api v2", () => {
  it("creates a bucket by global alias", async () => {
    const fetchFn = ok({ id: "b1", globalAliases: ["gs-snap-x"] });
    vi.stubGlobal("fetch", fetchFn);
    await expect(createBucket(admin, "gs-snap-x")).resolves.toEqual({ id: "b1" });
    expect(fetchFn.mock.calls[0][0]).toBe("http://127.0.0.1:3903/v2/CreateBucket");
    expect(fetchFn.mock.calls[0][1].method).toBe("POST");
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe("Bearer T");
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ globalAlias: "gs-snap-x" });
  });

  it("creates a key and returns the secret, which is shown exactly once", async () => {
    vi.stubGlobal("fetch", ok({ accessKeyId: "GK1", secretAccessKey: "S1", name: "n" }));
    await expect(createKey(admin, "n")).resolves.toEqual({
      accessKeyId: "GK1",
      secretAccessKey: "S1",
    });
  });

  it("grants read-only, never owner, for a tenant reader", async () => {
    const fetchFn = ok({ id: "b1" });
    vi.stubGlobal("fetch", fetchFn);
    await allowBucketKey(admin, "b1", "GK1", { read: true, write: false, owner: false });
    expect(fetchFn.mock.calls[0][0]).toBe("http://127.0.0.1:3903/v2/AllowBucketKey");
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({
      bucketId: "b1",
      accessKeyId: "GK1",
      permissions: { read: true, write: false, owner: false },
    });
  });

  it("returns null rather than throwing for an unknown alias", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "NoSuchBucket",
      }),
    );
    await expect(getBucketByAlias(admin, "nope")).resolves.toBeNull();
  });

  it("deletes by id as a query parameter", async () => {
    const fetchFn = ok({});
    vi.stubGlobal("fetch", fetchFn);
    await deleteBucket(admin, "b1");
    expect(fetchFn.mock.calls[0][0]).toBe("http://127.0.0.1:3903/v2/DeleteBucket?id=b1");
  });

  it("throws with the server body on any other error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "boom",
      }),
    );
    await expect(createBucket(admin, "x")).rejects.toThrow(/500.*boom/);
  });
});
