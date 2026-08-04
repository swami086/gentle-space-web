import { beforeEach, describe, expect, it, vi } from "vitest";

const { listMembers, listPendingUsers, upsertMembership } = vi.hoisted(() => ({
  listMembers: vi.fn(),
  listPendingUsers: vi.fn(),
  upsertMembership: vi.fn(),
}));
vi.mock("@/lib/db/org-members", () => ({
  listMembers,
  listPendingUsers,
  upsertMembership,
  INTERNAL_ORG_ID: "00000000-0000-0000-0000-000000000001",
}));

process.env.INTERNAL_API_KEY = "test-key";

import { GET, POST } from "./route";

function req(method: string, opts: { apiKey?: string; body?: unknown } = {}): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (opts.apiKey !== undefined) headers.set("x-internal-api-key", opts.apiKey);
  return new Request("http://localhost:3040/internal/org-members", {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

beforeEach(() => {
  listMembers.mockReset();
  listPendingUsers.mockReset();
  upsertMembership.mockReset();
});

describe("GET /internal/org-members", () => {
  it("rejects a missing or wrong api key with 401", async () => {
    expect((await GET(req("GET"))).status).toBe(401);
    expect((await GET(req("GET", { apiKey: "wrong" }))).status).toBe(401);
  });

  it("returns members + pending on a valid key", async () => {
    listMembers.mockResolvedValue([{ userId: "u-1", email: "a@x.com", name: null, role: "admin", lastLoginAt: null }]);
    listPendingUsers.mockResolvedValue([{ userId: "u-2", email: "b@x.com", name: null }]);
    const res = await GET(req("GET", { apiKey: "test-key" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      members: [{ userId: "u-1", email: "a@x.com", name: null, role: "admin", lastLoginAt: null }],
      pending: [{ userId: "u-2", email: "b@x.com", name: null }],
    });
    expect(listMembers).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001");
  });
});

describe("POST /internal/org-members", () => {
  it("rejects a missing or wrong api key with 401", async () => {
    const res = await POST(req("POST", { body: { userId: "u-1", role: "admin" } }));
    expect(res.status).toBe(401);
  });

  it("rejects a missing userId with 400", async () => {
    const res = await POST(req("POST", { apiKey: "test-key", body: { role: "admin" } }));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid role with 400", async () => {
    const res = await POST(
      req("POST", { apiKey: "test-key", body: { userId: "u-1", role: "superadmin" } }),
    );
    expect(res.status).toBe(400);
  });

  it("assigns the role on a valid request", async () => {
    upsertMembership.mockResolvedValue(undefined);
    const res = await POST(req("POST", { apiKey: "test-key", body: { userId: "u-1", role: "operator" } }));
    expect(res.status).toBe(200);
    expect(upsertMembership).toHaveBeenCalledWith({
      orgId: "00000000-0000-0000-0000-000000000001",
      userId: "u-1",
      role: "operator",
      invitedBy: null,
    });
  });
});
