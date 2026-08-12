import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const ORG_SCOPE = { kind: "org" as const, orgId: "org-1" };
const PLATFORM_SCOPE = { kind: "platform" as const, orgId: "platform-org" };
const USER_ID = "user-1";
const FILTER_ID = "filter-1";

const savedFilter = {
  id: FILTER_ID,
  orgId: ORG_SCOPE.orgId,
  ownerUserId: USER_ID,
  name: "Pending pauses",
  query: { statuses: ["pending"], kinds: ["pause"] },
  createdAt: "2026-08-13T00:00:00.000Z",
};

const { listSavedFilters, createSavedFilter, deleteSavedFilter, guard } = vi.hoisted(() => ({
  listSavedFilters: vi.fn(),
  createSavedFilter: vi.fn(),
  deleteSavedFilter: vi.fn(),
  guard: vi.fn(),
}));

vi.mock("@/lib/db/proposal-filters", () => ({
  listSavedFilters,
  createSavedFilter,
  deleteSavedFilter,
}));
vi.mock("@/lib/auth/guard", () => ({ guard }));

import { DELETE, GET, POST } from "./route";

function adminAccess(scope: typeof ORG_SCOPE | typeof PLATFORM_SCOPE = ORG_SCOPE) {
  return {
    ok: true as const,
    session: { userId: USER_ID, email: "admin@x.com", orgId: scope.orgId, role: "admin" as const },
    scope,
  };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/proposals/filters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function del(id: string | null) {
  const url = id
    ? `http://localhost/api/proposals/filters?id=${encodeURIComponent(id)}`
    : "http://localhost/api/proposals/filters";
  return DELETE(new Request(url, { method: "DELETE" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue(adminAccess());
  listSavedFilters.mockResolvedValue([savedFilter]);
  createSavedFilter.mockResolvedValue(savedFilter);
  deleteSavedFilter.mockResolvedValue(true);
});

describe("GET /api/proposals/filters", () => {
  it("returns 403 when guard rejects the caller", async () => {
    guard.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(listSavedFilters).not.toHaveBeenCalled();
  });

  it("lists saved filters for the authenticated admin", async () => {
    const res = await GET();
    expect(listSavedFilters).toHaveBeenCalledWith(ORG_SCOPE, USER_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ filters: [savedFilter] });
  });
});

describe("POST /api/proposals/filters", () => {
  it("returns 403 when guard rejects the caller", async () => {
    guard.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await post({ name: "x", query: {} });
    expect(res.status).toBe(403);
    expect(createSavedFilter).not.toHaveBeenCalled();
  });

  it("rejects a missing or empty name", async () => {
    const res = await post({ name: "  ", query: {} });
    expect(res.status).toBe(400);
    expect(createSavedFilter).not.toHaveBeenCalled();
  });

  it("rejects an invalid query shape", async () => {
    const res = await post({ name: "ok", query: "bad" });
    expect(res.status).toBe(400);
    expect(createSavedFilter).not.toHaveBeenCalled();
  });

  it("rejects unknown proposal statuses", async () => {
    const res = await post({ name: "ok", query: { statuses: ["bogus"] } });
    expect(res.status).toBe(400);
    expect(createSavedFilter).not.toHaveBeenCalled();
  });

  it("rejects orgIds from a non-platform admin", async () => {
    const res = await post({
      name: "Cross org",
      query: { orgIds: ["other-org"] },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "orgIds requires platform staff" });
    expect(createSavedFilter).not.toHaveBeenCalled();
  });

  it("creates a filter without orgIds for an org admin", async () => {
    const res = await post({
      name: "Pending pauses",
      query: { statuses: ["pending"], kinds: ["pause"] },
    });
    expect(createSavedFilter).toHaveBeenCalledWith(ORG_SCOPE, USER_ID, {
      name: "Pending pauses",
      query: { statuses: ["pending"], kinds: ["pause"] },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ filter: savedFilter });
  });

  it("allows orgIds for platform staff", async () => {
    guard.mockResolvedValue(adminAccess(PLATFORM_SCOPE));
    const res = await post({
      name: "All pending",
      query: { statuses: ["pending"], orgIds: ["org-a", "org-b"] },
    });
    expect(createSavedFilter).toHaveBeenCalledWith(PLATFORM_SCOPE, USER_ID, {
      name: "All pending",
      query: { statuses: ["pending"], orgIds: ["org-a", "org-b"] },
    });
    expect(res.status).toBe(201);
  });

  it("maps duplicate names to 409", async () => {
    createSavedFilter.mockRejectedValue(
      Object.assign(new Error("duplicate key"), { code: "23505" }),
    );
    const res = await post({ name: "Pending pauses", query: {} });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "filter name already exists" });
  });
});

describe("DELETE /api/proposals/filters", () => {
  it("returns 403 when guard rejects the caller", async () => {
    guard.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await del(FILTER_ID);
    expect(res.status).toBe(403);
    expect(deleteSavedFilter).not.toHaveBeenCalled();
  });

  it("requires an id query param", async () => {
    const res = await del(null);
    expect(res.status).toBe(400);
    expect(deleteSavedFilter).not.toHaveBeenCalled();
  });

  it("returns 404 when the filter is not owned by the caller", async () => {
    deleteSavedFilter.mockResolvedValue(false);
    const res = await del(FILTER_ID);
    expect(deleteSavedFilter).toHaveBeenCalledWith(ORG_SCOPE, USER_ID, FILTER_ID);
    expect(res.status).toBe(404);
  });

  it("deletes an owned filter", async () => {
    const res = await del(FILTER_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
