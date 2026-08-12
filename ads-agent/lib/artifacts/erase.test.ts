import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Scope } from "../db/scope-sql";

const ORG = "11111111-1111-1111-1111-111111111111";
const SUBJECT = "44444444-4444-4444-4444-444444444444";
const REQUEST = "55555555-5555-5555-5555-555555555555";
const KEY = `artifacts/${ORG}/draft/22222222-2222-2222-2222-222222222222`;
const scope = { kind: "org", orgId: ORG } as Scope;

const ops: string[] = [];
const query = vi.fn();
const clientQuery = vi.fn();
const enqueueEvent = vi.fn().mockResolvedValue("evt");

vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));
vi.mock("../db/scope-sql", () => ({
  scopeClause: () => ({ sql: "org_id = $1", params: [ORG] }),
}));
vi.mock("../db/outbox", () => ({ enqueueEvent }));
vi.mock("../db/tx", () => ({
  withTenantTransaction: async (
    _scope: unknown,
    fn: (client: { query: typeof clientQuery }) => Promise<unknown>,
  ) => fn({ query: clientQuery }),
}));

function storeWithBytes(presentAfterDelete: boolean[]) {
  let headCall = 0;
  return {
    remove: vi.fn(async (_b: string, k: string) => {
      ops.push(`remove:${k}`);
    }),
    head: vi.fn(async (_b: string, k: string) => {
      ops.push(`head:${k}`);
      return presentAfterDelete[headCall++]
        ? { key: k, byteSize: 1, lastModified: new Date() }
        : null;
    }),
    list: async function* () {
      yield { key: KEY, byteSize: 1, lastModified: new Date() };
    },
    put: vi.fn(),
    get: vi.fn(),
  };
}

beforeEach(() => {
  ops.length = 0;
  query.mockReset();
  clientQuery.mockReset();
  enqueueEvent.mockClear();
});

describe("eraseArtifactsForSubject", () => {
  it("deletes bytes, proves absence, then tombstones -- in that order", async () => {
    query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("subject_refs @>")) {
        return { rows: [{ id: "a1", storage_key: KEY }], rowCount: 1 };
      }
      ops.push("tombstone");
      return { rows: [], rowCount: 1 };
    });
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { eraseArtifactsForSubject } = await import("./erase");
    const out = await eraseArtifactsForSubject(
      scope,
      SUBJECT,
      REQUEST,
      storeWithBytes([false]) as never,
    );

    expect(ops).toEqual([`remove:${KEY}`, `head:${KEY}`, "tombstone"]);
    expect(out).toEqual({ erasedIds: ["a1"], deletedKeys: [KEY] });
  });

  it("refuses to record an erasure while the object is still there", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("subject_refs @>")
        ? { rows: [{ id: "a1", storage_key: KEY }], rowCount: 1 }
        : { rows: [], rowCount: 1 },
    );

    const { eraseArtifactsForSubject } = await import("./erase");
    await expect(
      eraseArtifactsForSubject(scope, SUBJECT, REQUEST, storeWithBytes([true]) as never),
    ).rejects.toThrow(/still present/);
    expect(ops).not.toContain("tombstone");
  });

  it("writes the ledger and the outbox event on one client, in one transaction", async () => {
    query.mockImplementation(async (sql: string) =>
      String(sql).includes("subject_refs @>")
        ? { rows: [], rowCount: 0 }
        : { rows: [], rowCount: 1 },
    );
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { eraseArtifactsForSubject } = await import("./erase");
    await eraseArtifactsForSubject(scope, SUBJECT, REQUEST, storeWithBytes([]) as never);

    const sql = clientQuery.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toContain("context.deletion_propagations");
    expect(sql).toContain("'objectstore'");
    expect(enqueueEvent).toHaveBeenCalledWith(
      { kind: "org", orgId: ORG },
      expect.objectContaining({ query: clientQuery }),
      expect.objectContaining({
        topic: "deletion.requested",
        payload: expect.objectContaining({ store: "objectstore", requestId: REQUEST }),
      }),
    );
  });
});

describe("eraseArtifactsForTenant", () => {
  it("prefix-deletes, verifies every key, then tombstones the whole tenant", async () => {
    query.mockResolvedValue({ rows: [{ id: "a1" }], rowCount: 1 });
    clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { eraseArtifactsForTenant } = await import("./erase");
    const out = await eraseArtifactsForTenant(scope, REQUEST, storeWithBytes([false]) as never);

    expect(ops).toEqual([`remove:${KEY}`, `head:${KEY}`]);
    expect(out.deletedKeys).toEqual([KEY]);
    expect(String(query.mock.calls[0][0])).toContain("SET erased_at = now()");
  });
});
