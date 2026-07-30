import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { firecrawlMap, firecrawlScrape } from "./client";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  process.env.FIRECRAWL_API_KEY = "fc-test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FIRECRAWL_API_KEY;
});

describe("firecrawlScrape", () => {
  it("POSTs v1 scrape with markdown+links and onlyMainContent", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          markdown: "# WeWork\nHot desks from ₹5000",
          links: ["https://example.com/amenities", "https://example.com/book"],
        },
      }),
    });

    const result = await firecrawlScrape("https://example.com/wework");

    expect(fetchMock).toHaveBeenCalledWith("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: "Bearer fc-test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: "https://example.com/wework",
        formats: ["markdown", "links"],
        onlyMainContent: true,
      }),
    });
    expect(result).toEqual({
      markdown: "# WeWork\nHot desks from ₹5000",
      links: ["https://example.com/amenities", "https://example.com/book"],
    });
  });

  it("defaults missing markdown/links to empty values", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: {} }),
    });

    const result = await firecrawlScrape("https://example.com/empty");
    expect(result).toEqual({ markdown: "", links: [] });
  });

  it("throws when FIRECRAWL_API_KEY is missing", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    await expect(firecrawlScrape("https://example.com")).rejects.toThrow(
      "FIRECRAWL_API_KEY is not set",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on API failure", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ success: false, error: "Insufficient credits" }),
    });

    await expect(firecrawlScrape("https://example.com")).rejects.toThrow(
      "Insufficient credits",
    );
  });
});

describe("firecrawlMap", () => {
  it("POSTs v1 map and returns link URLs", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        links: [
          "https://coworker.com/bangalore/wework",
          "https://coworker.com/bangalore/91springboard",
        ],
      }),
    });

    const links = await firecrawlMap("https://coworker.com/bangalore");

    expect(fetchMock).toHaveBeenCalledWith("https://api.firecrawl.dev/v1/map", {
      method: "POST",
      headers: {
        Authorization: "Bearer fc-test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: "https://coworker.com/bangalore" }),
    });
    expect(links).toEqual([
      "https://coworker.com/bangalore/wework",
      "https://coworker.com/bangalore/91springboard",
    ]);
  });

  it("throws when FIRECRAWL_API_KEY is missing", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    await expect(firecrawlMap("https://example.com")).rejects.toThrow(
      "FIRECRAWL_API_KEY is not set",
    );
  });
});
