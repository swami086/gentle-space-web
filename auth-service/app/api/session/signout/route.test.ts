import { beforeEach, describe, expect, it, vi } from "vitest";

const { signOut, revokeRefreshToken } = vi.hoisted(() => ({
  signOut: vi.fn(),
  revokeRefreshToken: vi.fn(),
}));

vi.mock("@/auth", () => ({ signOut }));
vi.mock("@/lib/db/refresh-tokens", () => ({ revokeRefreshToken }));

process.env.COOKIE_DOMAIN = "localhost";

import { GET } from "./route";

beforeEach(() => {
  signOut.mockReset();
  revokeRefreshToken.mockReset();
  signOut.mockResolvedValue(undefined);
});

function requestWithRefreshCookie(cookieValue: string | null, returnTo?: string) {
  const url = new URL("http://localhost:3040/api/session/signout");
  if (returnTo) url.searchParams.set("return_to", returnTo);
  const headers = new Headers();
  if (cookieValue) headers.set("cookie", `gs_refresh=${cookieValue}`);
  return new Request(url, { headers });
}

describe("GET /api/session/signout", () => {
  it("revokes the refresh token when a gs_refresh cookie is present", async () => {
    await GET(requestWithRefreshCookie("raw-refresh-token"));
    expect(revokeRefreshToken).toHaveBeenCalledWith("raw-refresh-token");
  });

  it("does not call revokeRefreshToken when there is no gs_refresh cookie", async () => {
    await GET(requestWithRefreshCookie(null));
    expect(revokeRefreshToken).not.toHaveBeenCalled();
  });

  it("calls next-auth's signOut with redirect disabled", async () => {
    await GET(requestWithRefreshCookie(null));
    expect(signOut).toHaveBeenCalledWith({ redirect: false });
  });

  it("clears the gs_refresh cookie and redirects to the safe return_to destination", async () => {
    const res = await GET(requestWithRefreshCookie("raw-refresh-token", "http://localhost:3040/login"));
    expect(res.headers.get("set-cookie")).toContain("gs_refresh=;");
    expect(res.headers.get("location")).toBe("http://localhost:3040/login");
  });

  it("falls back to / when return_to is missing or unsafe", async () => {
    const res = await GET(requestWithRefreshCookie(null, "https://evil.example.com/"));
    expect(res.headers.get("location")).toBe("http://localhost:3040/");
  });
});
