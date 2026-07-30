import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InsightFacts } from "../spaces/insight-types";

vi.mock("./auth", () => ({
  getVertexAccessToken: vi.fn(async () => "token"),
}));

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
  process.env.GOOGLE_CLOUD_PROJECT = "test-project";
});

afterEach(() => {
  delete process.env.GOOGLE_CLOUD_PROJECT;
  vi.unstubAllGlobals();
});

describe("vertex explainListingFit", () => {
  it("sends an abort signal on insight requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: "fits", highlights: [] }) }] } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { explainListingFit } = await import("./client");
    await explainListingFit(facts);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBeDefined();
  });
});
