import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return actual;
});

process.env.AUTH_SERVICE_URL = "http://localhost:3040";

import { NextRequest } from "next/server";
import { middleware } from "./middleware";

describe("middleware", () => {
  it("redirects to auth-service login when there is no gs_session cookie", () => {
    const req = new NextRequest("http://localhost:3030/campaigns");
    const res = middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3040/login?return_to=http%3A%2F%2Flocalhost%3A3030%2Fcampaigns",
    );
  });

  it("passes the request through when a gs_session cookie is present", () => {
    const req = new NextRequest("http://localhost:3030/campaigns", {
      headers: { cookie: "gs_session=some-token" },
    });
    const res = middleware(req);
    expect(res.status).toBe(200);
  });
});
