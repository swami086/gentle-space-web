import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Scope } from "../db/scope-sql";

const ORG = "11111111-1111-1111-1111-111111111111";
const NEW_ID = "22222222-2222-2222-2222-222222222222";
const scope = { kind: "org", orgId: ORG } as Scope;

const calls: string[] = [];
const query = vi.fn();

vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));
vi.mock("../db/scope-sql", () => ({
  scopeClause: () => ({ sql: "org_id = $1", params: [ORG] }),
}));

function fakeStore() {
  return {
    put: vi.fn(async () => {
      calls.push("put");
    }),
    get: vi.fn(async () => new TextEncoder().encode("payload")),
    head: vi.fn(async () => null),
    remove: vi.fn(async () => {}),
    list: vi.fn(),
  };
}

const dbRow = (over: Record<string, unknown> = {}) => ({
  id: NEW_ID,
  org_id: ORG,
  storage_key: `artifacts/${ORG}/draft/${NEW_ID}`,
  content_type: "draft",
  media_type: "application/json",
  byte_size: 7,
  checksum: "c",
  subject_refs: [],
  created_at: new Date(),
  erase_after: new Date(),
  erased_at: null,
  ...over,
});

beforeEach(() => {
  calls.length = 0;
  query.mockReset();
});

describe("putArtifact", () => {
  it("writes bytes before the row, so a crash leaves reclaimable residue", async () => {
    query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("uuidv7()")) {
        calls.push("id");
        return { rows: [{ id: NEW_ID }], rowCount: 1 };
      }
      calls.push("insert");
      return { rows: [dbRow()], rowCount: 1 };
    });
    const { putArtifact } = await import("./store");
    await putArtifact(
      scope,
      { contentType: "draft", body: new TextEncoder().encode("payload") },
      fakeStore() as never,
    );
    expect(calls).toEqual(["id", "put", "insert"]);
  });

  it("takes the id from Postgres so it is a uuidv7, not a v4", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("uuidv7()")
        ? { rows: [{ id: NEW_ID }], rowCount: 1 }
        : { rows: [dbRow()], rowCount: 1 },
    );
    const { putArtifact } = await import("./store");
    await putArtifact(scope, { contentType: "draft", body: new Uint8Array() }, fakeStore() as never);
    expect(String(query.mock.calls[0][0])).toContain("uuidv7()");
  });

  it("builds the key from the scope and checksums the bytes", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("uuidv7()")
        ? { rows: [{ id: NEW_ID }], rowCount: 1 }
        : { rows: [dbRow()], rowCount: 1 },
    );
    const store = fakeStore();
    const { putArtifact } = await import("./store");
    await putArtifact(
      scope,
      { contentType: "draft", body: new TextEncoder().encode("hello") },
      store as never,
    );

    expect(store.put.mock.calls[0][1]).toBe(`artifacts/${ORG}/draft/${NEW_ID}`);
    expect(query.mock.calls[1][1]).toContain(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("gives call recordings a different retention from text artifacts", async () => {
    const { RETENTION_DAYS } = await import("./store");
    expect(RETENTION_DAYS.draft).toBe(400);
    expect(RETENTION_DAYS.call_recording).toBe(366);
  });
});

describe("getArtifact", () => {
  it("returns null for another tenant's id, so the caller can 404", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    const { getArtifact } = await import("./store");
    await expect(getArtifact(scope, NEW_ID, fakeStore() as never)).resolves.toBeNull();
  });

  it("returns the row with a null body for a tombstone", async () => {
    query.mockResolvedValue({ rows: [dbRow({ erased_at: new Date() })], rowCount: 1 });
    const store = fakeStore();
    const { getArtifact } = await import("./store");
    const out = await getArtifact(scope, NEW_ID, store as never);
    expect(out!.body).toBeNull();
    expect(store.get).not.toHaveBeenCalled();
  });

  it("throws when the key's tenant segment disagrees with the row", async () => {
    query.mockResolvedValue({
      rows: [dbRow({ storage_key: "artifacts/33333333-3333-3333-3333-333333333333/draft/x" })],
      rowCount: 1,
    });
    const { getArtifact } = await import("./store");
    await expect(getArtifact(scope, NEW_ID, fakeStore() as never)).rejects.toThrow(
      /storage key tenant/,
    );
  });

  it("returns the bytes for a live artifact", async () => {
    query.mockResolvedValue({ rows: [dbRow()], rowCount: 1 });
    const { getArtifact } = await import("./store");
    const out = await getArtifact(scope, NEW_ID, fakeStore() as never);
    expect(new TextDecoder().decode(out!.body!)).toBe("payload");
  });
});

describe("listArtifactsForSubject", () => {
  it("uses array containment, which is what the GIN index serves", async () => {
    query.mockResolvedValue({ rows: [dbRow()], rowCount: 1 });
    const { listArtifactsForSubject } = await import("./store");
    await listArtifactsForSubject(scope, "44444444-4444-4444-4444-444444444444");
    expect(String(query.mock.calls[0][0])).toContain("subject_refs @> ARRAY[");
  });
});
