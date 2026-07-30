import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InsightFacts } from "../spaces/insight-types";

vi.mock("./auth", () => ({
  getVertexAccessToken: vi.fn().mockResolvedValue("vertex-test-token"),
}));

const fetchMock = vi.fn();

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
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  process.env.GOOGLE_CLOUD_PROJECT = "test-project";
  process.env.GOOGLE_CLOUD_LOCATION = "us-central1";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GOOGLE_CLOUD_LOCATION;
});

describe("extractSearchEntities", () => {
  it("requests generateContent with json mime type and temperature 0", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    areas: [" Indiranagar "],
                    amenities: [" WiFi "],
                    deskTypes: [" Private Cabin "],
                    landmarks: [" Metro Station "],
                    budgetSignals: [" Under 20k "],
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const { extractSearchEntities } = await import("./client");
    await expect(extractSearchEntities("private cabin near metro")).resolves.toEqual({
      areas: ["indiranagar"],
      amenities: ["wifi"],
      deskTypes: ["private cabin"],
      landmarks: ["metro station"],
      budgetSignals: ["under 20k"],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(":generateContent"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer vertex-test-token",
          "Content-Type": "application/json",
        }),
      }),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.generationConfig).toEqual({
      responseMimeType: "application/json",
      temperature: 0,
    });
  });
});

describe("vertex explainListingFit", () => {
  it("sends an abort signal on insight requests", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    summaryEvidenceIds: ["listing.area"],
                    highlightEvidenceIds: [],
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const { explainListingFit } = await import("./client");
    await explainListingFit(facts);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBeDefined();
  });
});
