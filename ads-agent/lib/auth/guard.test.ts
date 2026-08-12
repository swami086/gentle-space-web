import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiRole, query } = vi.hoisted(() => ({
  requireApiRole: vi.fn(),
  query: vi.fn(),
}));
vi.mock("./dal", () => ({ requireApiRole }));
vi.mock("@/lib/db/client", () => ({ getPool: () => ({ query }) }));

import { guard, ownedOr404 } from "./guard";
import type { Scope } from "@/lib/db/scope-sql";

const ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const session = { userId: "u1", email: "a@b.com", orgId: ORG_ID, role: "admin" as const };

beforeEach(() => {
  requireApiRole.mockReset();
  query.mockReset();
});

describe("guard", () => {
  it("passes the role check failure straight through", async () => {
    const response = new Response(null, { status: 403 });
    requireApiRole.mockResolvedValue({ ok: false, response });
    const result = await guard("admin");
    expect(result).toEqual({ ok: false, response });
  });

  it("returns platform scope for an internal org", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session });
    query.mockResolvedValue({ rows: [{ kind: "internal" }] });
    const result = await guard("viewer");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scope).toEqual({ kind: "platform", orgId: ORG_ID });
  });

  it("returns org scope for an external org", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session });
    query.mockResolvedValue({ rows: [{ kind: "external" }] });
    const result = await guard("viewer");
    if (result.ok) expect(result.scope).toEqual({ kind: "org", orgId: ORG_ID });
  });

  it("returns 403 rather than throwing when the session has no org", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { ...session, orgId: null } });
    const result = await guard("viewer");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("treats an unknown org as external — fail closed", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session });
    query.mockResolvedValue({ rows: [] });
    const result = await guard("viewer");
    if (result.ok) expect(result.scope.kind).toBe("org");
  });
});

describe("ownedOr404", () => {
  const scope: Scope = { kind: "org", orgId: ORG_ID };

  it("returns the entity when the loader finds it in scope", async () => {
    const result = await ownedOr404(async () => ({ id: "x" }), scope);
    expect(result).toEqual({ ok: true, entity: { id: "x" } });
  });

  it("returns 404 and never 403 for a miss", async () => {
    const result = await ownedOr404(async () => null, scope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status, "403 would confirm the row exists").toBe(404);
      await expect(result.response.json()).resolves.toEqual({ error: "not found" });
    }
  });

  it("passes the scope to the loader", async () => {
    const loader = vi.fn().mockResolvedValue({ id: "x" });
    await ownedOr404(loader, scope);
    expect(loader).toHaveBeenCalledWith(scope);
  });
});
