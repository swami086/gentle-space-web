import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emitSearchPerformed } from "./emit";

beforeEach(() => {
  process.env.PORTAL_INGEST_ORIGIN = "https://ads.test";
  process.env.GENTLE_SPACE_INGEST_KEY = "pk_live_gentlespace";
  process.env.NEXT_PUBLIC_SITE_ORIGIN = "https://gentlespace.test";
});
afterEach(() => vi.unstubAllGlobals());

const input = { sessionId: "abcdefabcdefabcdef01", query: "hsr 20 desks", filters: { area: "HSR" }, resultCount: 0 };

describe("emitSearchPerformed", () => {
  it("posts a taxonomy-shaped search_performed event to the ingestion edge", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ accepted: 1 }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await emitSearchPerformed(input);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://ads.test/api/v1/ingest");
    expect(init.headers["X-Ingest-Key"]).toBe("pk_live_gentlespace");
    expect(init.headers.Origin).toBe("https://gentlespace.test");
    const body = JSON.parse(init.body);
    expect(body.taxonomy_version).toBe(1);
    expect(body.session_id).toBe("abcdefabcdefabcdef01");
    expect(body.events).toHaveLength(1);
    expect(body.events[0].event).toBe("search_performed");
    expect(body.events[0].payload).toEqual({ query: "hsr 20 desks", filters: { area: "HSR" }, result_count: 0 });
  });

  it("soft-fails on a rejection, because logging must never break search", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "no_consent" }, { status: 403 })));
    await expect(emitSearchPerformed(input)).resolves.toBeUndefined();
  });

  it("soft-fails when the edge is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(emitSearchPerformed(input)).resolves.toBeUndefined();
  });

  it("does nothing when the site has no ingest key configured", async () => {
    delete process.env.GENTLE_SPACE_INGEST_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await emitSearchPerformed(input);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
