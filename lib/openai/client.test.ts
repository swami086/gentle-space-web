import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InsightFacts } from "../spaces/insight-types";

const facts: InsightFacts = {
  title: "CoWrks Ecoworld",
  area: "Bellandur",
  city: "Bengaluru",
  propertyType: null,
  pricingHint: null,
  amenities: [],
  description: "",
  query: "coworking in bellandur",
  nearby: [],
};

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  process.env.AI_PROVIDER = "openai";
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_PROVIDER;
  vi.unstubAllGlobals();
});

describe("embedTexts", () => {
  it("returns vectors from OpenAI embeddings API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2], index: 0 }],
        }),
      }),
    );
    const { embedTexts } = await import("./client");
    const vectors = await embedTexts(["hello"]);
    expect(vectors[0]).toEqual([0.1, 0.2]);
  });
});

describe("rewriteSearchQuery", () => {
  it("returns assistant content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Private cabin · Metro · Bangalore" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rewriteSearchQuery } = await import("./client");
    await expect(rewriteSearchQuery("quiet cabin near metro")).resolves.toBe(
      "Private cabin · Metro · Bangalore",
    );
  });
});

describe("extractSearchEntities", () => {
  it("requests json mode and parses extracted entities", async () => {
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
    const { extractSearchEntities } = await import("./client");
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

describe("openai explainListingFit", () => {
  it("sends max_tokens and an abort signal on insight requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: { text: "fits", evidenceIds: ["listing.area"] },
                highlights: [],
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { explainListingFit } = await import("./client");
    await explainListingFit(facts);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBeDefined();
    expect(JSON.parse(init.body)).toMatchObject({ max_tokens: 320 });
  });
});
