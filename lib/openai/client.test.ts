import { afterEach, describe, expect, it, vi } from "vitest";
import { embedTexts, extractSearchEntities, rewriteSearchQuery } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("embedTexts", () => {
  it("returns vectors from OpenAI embeddings API", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2], index: 0 }],
        }),
      }),
    );
    const vectors = await embedTexts(["hello"]);
    expect(vectors[0]).toEqual([0.1, 0.2]);
  });
});

describe("rewriteSearchQuery", () => {
  it("returns assistant content", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Private cabin · Metro · Bangalore" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(rewriteSearchQuery("quiet cabin near metro")).resolves.toBe(
      "Private cabin · Metro · Bangalore",
    );
  });
});

describe("extractSearchEntities", () => {
  it("requests json mode and parses extracted entities", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                areas: [" Indiranagar "],
                amenities: [" WiFi "],
                deskTypes: [" Private Cabin "],
                landmarks: [" Metro Station "],
                budgetSignals: [" Under 20k "],
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(extractSearchEntities("private cabin near metro")).resolves.toEqual({
      areas: ["indiranagar"],
      amenities: ["wifi"],
      deskTypes: ["private cabin"],
      landmarks: ["metro station"],
      budgetSignals: ["under 20k"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"response_format":{"type":"json_object"}'),
      }),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.temperature).toBe(0);
  });
});
