import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
}));
const poolMock = vi.hoisted(() => ({
  connect: vi.fn(),
  end: vi.fn(),
}));
vi.mock("pg", () => ({
  Pool: class {
    connect = poolMock.connect;
    end = poolMock.end;
  },
}));

import { withAgentTenantTx, withAgentTenantWriteTx, getAgentReadPool } from "./db";

const ORG_A = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGENT_RO_DATABASE_URL = "postgres://agent_ro@localhost:5432/gentle_space";
  clientMock.query.mockResolvedValue({ rows: [], rowCount: 0 });
  poolMock.connect.mockResolvedValue(clientMock);
});

afterEach(() => {
  delete process.env.AGENT_RO_DATABASE_URL;
});

describe("withAgentTenantTx", () => {
  it("sets the tenant through public.set_tenant inside the same transaction, then commits", async () => {
    await withAgentTenantTx(ORG_A, async (tx) => {
      await tx.query("SELECT 1");
      return null;
    });
    const statements = clientMock.query.mock.calls.map((c) => c[0]);
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toBe("SELECT public.set_tenant($1)");
    expect(clientMock.query.mock.calls[1][1]).toEqual([ORG_A]);
    expect(statements[2]).toBe("LOAD 'pg_clickhouse'");
    expect(statements[3]).toBe(
      `SET pg_clickhouse.session_settings = $$SQL_current_tenant_id '${ORG_A}'$$`,
    );
    expect(statements.at(-1)).toBe("COMMIT");
  });

  it("rolls back and releases the connection when the body throws", async () => {
    await expect(
      withAgentTenantTx(ORG_A, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(clientMock.query.mock.calls.map((c) => c[0])).toContain("ROLLBACK");
    expect(clientMock.release).toHaveBeenCalledOnce();
  });

  it("never issues SET TRANSACTION READ WRITE", async () => {
    await withAgentTenantTx(ORG_A, async () => null);
    expect(clientMock.query.mock.calls.map((c) => c[0])).not.toContain("SET TRANSACTION READ WRITE");
  });
});

describe("withAgentTenantWriteTx", () => {
  it("opts the transaction into read-write before setting the tenant", async () => {
    await withAgentTenantWriteTx(ORG_A, async () => null);
    const statements = clientMock.query.mock.calls.map((c) => c[0]);
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toBe("SET TRANSACTION READ WRITE");
    expect(statements[2]).toBe("SELECT public.set_tenant($1)");
    expect(statements[3]).toBe("LOAD 'pg_clickhouse'");
    expect(statements[4]).toBe(
      `SET pg_clickhouse.session_settings = $$SQL_current_tenant_id '${ORG_A}'$$`,
    );
  });
});

describe("getAgentReadPool", () => {
  it("refuses to build a pool without AGENT_RO_DATABASE_URL", () => {
    delete process.env.AGENT_RO_DATABASE_URL;
    expect(() => getAgentReadPool()).toThrow("AGENT_RO_DATABASE_URL is not set");
  });

  it("never falls back to DATABASE_URL, which is the owner connection", () => {
    delete process.env.AGENT_RO_DATABASE_URL;
    process.env.DATABASE_URL = "postgres://owner@localhost:5432/gentle_space";
    expect(() => getAgentReadPool()).toThrow("AGENT_RO_DATABASE_URL is not set");
  });
});
