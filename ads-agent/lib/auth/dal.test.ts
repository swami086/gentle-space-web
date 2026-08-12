import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookieStore, redirectMock, jwtVerifyMock, query } = vi.hoisted(() => ({
  cookieStore: { get: vi.fn() },
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  jwtVerifyMock: vi.fn(),
  query: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("jose", () => ({
  jwtVerify: (...args: unknown[]) => jwtVerifyMock(...args),
  createRemoteJWKSet: vi.fn(() => "jwks-handle"),
}));
vi.mock("../db/client", () => ({ getPool: () => ({ query }) }));

process.env.AUTH_SERVICE_URL = "http://localhost:3040";

import {
  getSession,
  requireSession,
  requireRole,
  requireApiRole,
  ROLE_RANK,
  type MemberRole,
} from "./dal";

beforeEach(() => {
  cookieStore.get.mockReset();
  jwtVerifyMock.mockReset();
  query.mockReset();
  redirectMock.mockClear();
  query.mockResolvedValue({ rows: [] });
});

describe("role vocabulary", () => {
  it("ranks every role the database can store", () => {
    const storable: MemberRole[] = ["admin", "operator", "viewer"];
    for (const role of storable) {
      expect(ROLE_RANK[role], `${role} must have a rank`).toBeTypeOf("number");
    }
  });

  it("has no rank for a value the database can no longer store", () => {
    expect((ROLE_RANK as Record<string, number>).member).toBeUndefined();
  });

  it("shadow-upserts a role the users_role_check constraint accepts", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: "org-1", role: "operator" },
    });
    await getSession();
    const usersInsert = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO users"));
    expect(usersInsert, "expected a users upsert").toBeDefined();
    const written = String(usersInsert?.[0]).match(/'([a-z]+)'\s*\)\s*$/m)?.[1];
    expect(written, "hard-coded role literal in the users upsert").not.toBe("member");
    expect(["admin", "operator", "viewer"]).toContain(written);
  });
});

describe("getSession", () => {
  it("returns null when there is no session cookie", async () => {
    cookieStore.get.mockReturnValue(undefined);
    await expect(getSession()).resolves.toBeNull();
  });

  it("returns null when jwtVerify throws (invalid/expired/tampered)", async () => {
    cookieStore.get.mockReturnValue({ value: "bad-token" });
    jwtVerifyMock.mockRejectedValue(new Error("signature verification failed"));
    await expect(getSession()).resolves.toBeNull();
  });

  it("maps a valid pending-user token (no orgId/role) without JIT-provisioning", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: null, role: null },
    });
    await expect(getSession()).resolves.toEqual({
      userId: "u-1",
      email: "a@x.com",
      orgId: null,
      role: null,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("JIT-provisions shadow orgs/users rows for an active member", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: "org-1", role: "operator" },
    });
    const session = await getSession();
    expect(session).toEqual({ userId: "u-1", email: "a@x.com", orgId: "org-1", role: "operator" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO orgs"), ["org-1"]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO users"),
      expect.arrayContaining(["u-1", "org-1", "a@x.com"]),
    );
  });

  it("still returns the session when shadow upsert fails", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: "org-1", role: "admin" },
    });
    query.mockRejectedValueOnce(new Error("relation missing"));
    await expect(getSession()).resolves.toEqual({
      userId: "u-1",
      email: "a@x.com",
      orgId: "org-1",
      role: "admin",
    });
  });
});

describe("requireSession", () => {
  it("redirects to the auth-service login page when there is no session", async () => {
    cookieStore.get.mockReturnValue(undefined);
    await expect(requireSession()).rejects.toThrow("REDIRECT:http://localhost:3040/login");
  });

  it("returns the session when one exists", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: "org-1", role: "admin" },
    });
    await expect(requireSession()).resolves.toMatchObject({ userId: "u-1", role: "admin" });
  });
});

describe("requireRole", () => {
  it("reports unauthenticated when there is no session", async () => {
    cookieStore.get.mockReturnValue(undefined);
    await expect(requireRole("viewer")).resolves.toEqual({
      ok: false,
      session: null,
      reason: "unauthenticated",
    });
  });

  it("reports forbidden when the session has no role (pending)", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: null, role: null },
    });
    const result = await requireRole("viewer");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("forbidden");
  });

  it("reports forbidden when role rank is too low", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: "org-1", role: "viewer" },
    });
    const result = await requireRole("admin");
    expect(result.ok).toBe(false);
  });

  it("reports ok when role rank is sufficient", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: "org-1", role: "admin" },
    });
    const result = await requireRole("operator");
    expect(result.ok).toBe(true);
  });
});

describe("requireApiRole", () => {
  it("returns a 401 response when there is no session", async () => {
    cookieStore.get.mockReturnValue(undefined);
    const result = await requireApiRole("viewer");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("returns a 403 response when the role is insufficient", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: "org-1", role: "viewer" },
    });
    const result = await requireApiRole("admin");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("returns the session when the role is sufficient", async () => {
    cookieStore.get.mockReturnValue({ value: "good-token" });
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "u-1", email: "a@x.com", orgId: "org-1", role: "admin" },
    });
    const result = await requireApiRole("admin");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.userId).toBe("u-1");
  });
});
