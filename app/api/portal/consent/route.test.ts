import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

beforeEach(() => {
  process.env.PORTAL_INGEST_ORIGIN = "https://ads.test";
  process.env.GENTLE_SPACE_INGEST_KEY = "pk_live_gentlespace";
  process.env.NEXT_PUBLIC_SITE_ORIGIN = "https://gentlespace.test";
});
afterEach(() => vi.unstubAllGlobals());

function request(body: Record<string, unknown>, cookie?: string): Request {
  return new Request("https://gentlespace.test/api/portal/consent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/portal/consent", () => {
  it("forwards the grant with the site's own ingest key and mints a session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ consent_id: "c-1" }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const res = await POST(request({ purposes: ["space_recommendation"], action: "granted" }));

    expect(res.status).toBe(202);
    expect(res.headers.get("set-cookie")).toContain("gs_sid=");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://ads.test/api/v1/consent");
    const forwarded = JSON.parse(init.body);
    expect(forwarded.ingest_key).toBe("pk_live_gentlespace");
    expect(forwarded.mechanism).toBe("banner");
    expect(forwarded.session_id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(init.headers.Origin).toBe("https://gentlespace.test");
  });

  it("reuses an existing session cookie rather than starting a new session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ consent_id: "c-2" }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("./route");
    await POST(request({ purposes: ["site_analytics"], action: "withdrawn" }, "gs_sid=abcdefabcdefabcdef01"));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).session_id).toBe("abcdefabcdefabcdef01");
  });

  it("passes the upstream failure status through instead of claiming success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "unknown_key" }, { status: 404 })));
    const { POST } = await import("./route");
    expect((await POST(request({ purposes: ["site_analytics"], action: "granted" }))).status).toBe(404);
  });

  it("rejects a purpose outside the catalogue without calling upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("./route");
    expect((await POST(request({ purposes: ["everything"], action: "granted" }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
