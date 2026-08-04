import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authMock,
  findOrCreateUserByGoogle,
  touchLastLogin,
  getMembership,
  upsertMembership,
  createRefreshToken,
  mintAccessToken,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  findOrCreateUserByGoogle: vi.fn(),
  touchLastLogin: vi.fn(),
  getMembership: vi.fn(),
  upsertMembership: vi.fn(),
  createRefreshToken: vi.fn(),
  mintAccessToken: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));

vi.mock("@/lib/db/users", () => ({ findOrCreateUserByGoogle, touchLastLogin }));

vi.mock("@/lib/db/org-members", () => ({
  getMembership,
  upsertMembership,
  INTERNAL_ORG_ID: "00000000-0000-0000-0000-000000000001",
}));

vi.mock("@/lib/db/refresh-tokens", () => ({ createRefreshToken }));

vi.mock("@/lib/jwt", () => ({ mintAccessToken }));

process.env.COOKIE_DOMAIN = "localhost";
process.env.ADMIN_BOOTSTRAP_EMAILS = "admin@gentlespacesolutions.com";

import { GET } from "./route";

beforeEach(() => {
  authMock.mockReset();
  findOrCreateUserByGoogle.mockReset();
  touchLastLogin.mockReset();
  getMembership.mockReset();
  upsertMembership.mockReset();
  createRefreshToken.mockReset();
  mintAccessToken.mockReset();
  createRefreshToken.mockResolvedValue("raw-refresh-token");
  mintAccessToken.mockResolvedValue("signed-jwt");
});

describe("GET /bridge", () => {
  it("redirects to /login when there is no Auth.js session yet", async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost:3040/bridge"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3040/login");
  });

  it("auto-grants admin on first login for a bootstrap email, then sets cookies", async () => {
    authMock.mockResolvedValue({
      googleSub: "g-1",
      user: { email: "admin@gentlespacesolutions.com", name: "Admin", image: null },
    });
    findOrCreateUserByGoogle.mockResolvedValue({
      id: "u-1",
      email: "admin@gentlespacesolutions.com",
      name: "Admin",
      avatarUrl: null,
    });
    getMembership.mockResolvedValue(null);

    const res = await GET(
      new Request("http://localhost:3040/bridge?return_to=" + encodeURIComponent("http://localhost:3030/")),
    );

    expect(upsertMembership).toHaveBeenCalledWith({
      orgId: "00000000-0000-0000-0000-000000000001",
      userId: "u-1",
      role: "admin",
      invitedBy: null,
    });
    expect(mintAccessToken).toHaveBeenCalledWith({
      sub: "u-1",
      email: "admin@gentlespacesolutions.com",
      orgId: "00000000-0000-0000-0000-000000000001",
      role: "admin",
    });
    expect(res.headers.get("set-cookie")).toContain("gs_session=signed-jwt");
    expect(res.headers.get("set-cookie")).toContain("gs_refresh=raw-refresh-token");
    expect(res.headers.get("location")).toBe("http://localhost:3030/");
  });

  it("leaves a non-bootstrap first-time user pending (orgId/role null)", async () => {
    authMock.mockResolvedValue({
      googleSub: "g-2",
      user: { email: "someone@gmail.com", name: "Someone", image: null },
    });
    findOrCreateUserByGoogle.mockResolvedValue({
      id: "u-2",
      email: "someone@gmail.com",
      name: "Someone",
      avatarUrl: null,
    });
    getMembership.mockResolvedValue(null);

    await GET(new Request("http://localhost:3040/bridge"));

    expect(upsertMembership).not.toHaveBeenCalled();
    expect(mintAccessToken).toHaveBeenCalledWith({
      sub: "u-2",
      email: "someone@gmail.com",
      orgId: null,
      role: null,
    });
  });

  it("mints with the existing membership for a returning member", async () => {
    authMock.mockResolvedValue({
      googleSub: "g-3",
      user: { email: "operator@gmail.com", name: "Op", image: null },
    });
    findOrCreateUserByGoogle.mockResolvedValue({
      id: "u-3",
      email: "operator@gmail.com",
      name: "Op",
      avatarUrl: null,
    });
    getMembership.mockResolvedValue({ orgId: "00000000-0000-0000-0000-000000000001", role: "operator" });

    await GET(new Request("http://localhost:3040/bridge"));

    expect(upsertMembership).not.toHaveBeenCalled();
    expect(mintAccessToken).toHaveBeenCalledWith({
      sub: "u-3",
      email: "operator@gmail.com",
      orgId: "00000000-0000-0000-0000-000000000001",
      role: "operator",
    });
  });
});
