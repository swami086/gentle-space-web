import { describe, expect, it, vi } from "vitest";

const { getJwks } = vi.hoisted(() => ({ getJwks: vi.fn() }));
vi.mock("@/lib/jwt", () => ({ getJwks }));

import { GET } from "./route";

describe("GET /api/jwks", () => {
  it("returns the JWKS document from lib/jwt with a cache header", async () => {
    getJwks.mockResolvedValue({ keys: [{ kid: "k1" }] });
    const res = await GET();
    expect(await res.json()).toEqual({ keys: [{ kid: "k1" }] });
    expect(res.headers.get("cache-control")).toContain("max-age");
  });
});
