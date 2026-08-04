import { beforeEach, describe, expect, it, vi } from "vitest";

const { rotateRefreshToken, findUserById, getMembership, mintAccessToken } = vi.hoisted(() => ({
  rotateRefreshToken: vi.fn(),
  findUserById: vi.fn(),
  getMembership: vi.fn(),
  mintAccessToken: vi.fn(),
}));

vi.mock("@/lib/db/refresh-tokens", () => ({ rotateRefreshToken }));
vi.mock("@/lib/db/users", () => ({ findUserById }));
vi.mock("@/lib/db/org-members", () => ({ getMembership }));
vi.mock("@/lib/jwt", () => ({ mintAccessToken }));

process.env.COOKIE_DOMAIN = "localhost";

import { GET } from "./route";

beforeEach(() => {
  rotateRefreshToken.mockReset();
  findUserById.mockReset();
  getMembership.mockReset();
  mintAccessToken.mockReset();
  mintAccessToken.mockResolvedValue("new-signed-jwt");
});

function requestWithRefreshCookie(cookieValue: string | null, returnTo?: string) {
  const url = new URL("http://localhost:3040/api/refresh");
  if (returnTo) url.searchParams.set("return_to", returnTo);
  const headers = new Headers();
  if (cookieValue) headers.set("cookie", `gs_refresh=${cookieValue}`);
  return new Request(url, { headers });
}

describe("GET /api/refresh", () => {
  it("redirects to /login when there is no gs_refresh cookie", async () => {
    const res = await GET(requestWithRefreshCookie(null));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("redirects to /login when the refresh token doesn't rotate (expired/revoked/missing)", async () => {
    rotateRefreshToken.mockResolvedValue(null);
    const res = await GET(requestWithRefreshCookie("stale-token"));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("mints a fresh access token and rotates the refresh cookie on success", async () => {
    rotateRefreshToken.mockResolvedValue({ userId: "u-1", newRawToken: "new-refresh-token" });
    findUserById.mockResolvedValue({ id: "u-1", email: "a@x.com", name: null, avatarUrl: null });
    getMembership.mockResolvedValue({ orgId: "org-1", role: "operator" });

    const res = await GET(requestWithRefreshCookie("valid-token", "http://localhost:3030/campaigns"));

    expect(mintAccessToken).toHaveBeenCalledWith({
      sub: "u-1",
      email: "a@x.com",
      orgId: "org-1",
      role: "operator",
    });
    expect(res.headers.get("set-cookie")).toContain("gs_session=new-signed-jwt");
    expect(res.headers.get("set-cookie")).toContain("gs_refresh=new-refresh-token");
    expect(res.headers.get("location")).toBe("http://localhost:3030/campaigns");
  });
});
