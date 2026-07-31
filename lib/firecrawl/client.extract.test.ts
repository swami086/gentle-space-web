import { afterEach, describe, expect, it, vi } from "vitest";
import { firecrawlExtract } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("firecrawlExtract", () => {
  it("POSTs /v2/extract then polls until completed and maps by URL", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-test";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v2/extract") && init?.method === "POST") {
        return new Response(JSON.stringify({ success: true, id: "job-1" }), { status: 200 });
      }
      if (url.endsWith("/v2/extract/job-1")) {
        return new Response(
          JSON.stringify({
            success: true,
            status: "completed",
            data: {
              listings: [
                {
                  source_url: "https://ex.com/a",
                  locality: "HSR Layout",
                  address: null,
                  monthly_price_inr: 20000,
                  price_basis: "exact",
                  brand_match: true,
                  confidence: "medium",
                  evidence: null,
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const map = await firecrawlExtract(["https://ex.com/a"], {
      enableWebSearch: false,
      pollMs: 1,
      timeoutMs: 1000,
    });
    expect(map.get("https://ex.com/a")?.locality).toBe("HSR Layout");
    expect(fetchMock.mock.calls[0]?.[0]).toEqual("https://api.firecrawl.dev/v2/extract");
  });

  it("maps a single-URL flat data object to that URL", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v2/extract") && init?.method === "POST") {
          return new Response(JSON.stringify({ success: true, id: "job-2" }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            success: true,
            status: "completed",
            data: {
              locality: "Indiranagar",
              address: null,
              monthly_price_inr: null,
              price_basis: null,
              brand_match: true,
              confidence: "high",
              evidence: null,
            },
          }),
          { status: 200 },
        );
      }),
    );

    const map = await firecrawlExtract(["https://ex.com/b"], { pollMs: 1, timeoutMs: 1000 });
    expect(map.get("https://ex.com/b")?.locality).toBe("Indiranagar");
  });
});

