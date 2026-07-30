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

describe("openai explainListingFit", () => {
  it("sends max_tokens and an abort signal on insight requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ summary: "fits", highlights: [] }) } }],
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
