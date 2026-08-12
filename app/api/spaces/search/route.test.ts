import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Listing } from "@/lib/listings/types";

vi.mock("@/lib/ai/client", () => ({
  embedTexts: vi.fn(),
  rewriteSearchQuery: vi.fn(),
  extractSearchEntities: vi.fn(),
  isAiSearchConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/db/listings", () => ({
  searchListingsByEmbedding: vi.fn(),
}));

const emitSearchPerformed = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/portal/emit", () => ({
  emitSearchPerformed: (...args: unknown[]) => emitSearchPerformed(...args),
}));

vi.mock("../../../../lib/graph/age", () => ({
  scoreListingsAgainstQuery: vi.fn(),
}));

import {
  embedTexts,
  extractSearchEntities,
  isAiSearchConfigured,
  rewriteSearchQuery,
} from "@/lib/ai/client";
import { searchListingsByEmbedding } from "@/lib/db/listings";
import { toPublicListing } from "../../../../lib/listings/public";
import { scoreListingsAgainstQuery } from "../../../../lib/graph/age";
import { POST } from "./route";

const sampleListing: Listing = {
  id: "abc",
  source: "coworker",
  sourceId: "c1",
  slug: "wework-prestige",
  title: "WeWork Prestige",
  description: "A space",
  shortTeaser: "A space",
  address: "Koramangala",
  area: "Koramangala",
  city: "Bengaluru",
  lat: 12.93,
  lng: 77.62,
  amenities: ["WiFi"],
  images: ["https://example.com/img.jpg"],
  pricingHint: "₹5000",
  propertyType: "Coworking",
  sourceUrl: "https://example.com/wework",
  syncedAt: "2026-01-01T00:00:00.000Z",
};

const boostedListing: Listing = {
  ...sampleListing,
  id: "def",
  slug: "boosted-listing",
  title: "Boosted Listing",
};

function postSearch(body: unknown) {
  return POST(
    new Request("http://localhost/api/spaces/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAiSearchConfigured).mockReturnValue(true);
});

describe("POST /api/spaces/search", () => {
  it("returns 503 when env vars are missing", async () => {
    vi.mocked(isAiSearchConfigured).mockReturnValue(false);

    const res = await postSearch({ query: "quiet cabin" });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "search unavailable" });
    expect(rewriteSearchQuery).not.toHaveBeenCalled();
  });

  it("returns 400 for empty query", async () => {
    const res = await postSearch({ query: "   " });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid query" });
    expect(rewriteSearchQuery).not.toHaveBeenCalled();
  });

  it("returns interpreted query and listings on success", async () => {
    vi.mocked(rewriteSearchQuery).mockResolvedValue("Private cabin · Metro");
    vi.mocked(extractSearchEntities).mockResolvedValue({
      areas: ["koramangala"],
      amenities: [],
      deskTypes: [],
      landmarks: [],
      budgetSignals: [],
    });
    vi.mocked(embedTexts).mockResolvedValue([[0.1, 0.2, 0.3]]);
    vi.mocked(searchListingsByEmbedding).mockResolvedValue([
      { listing: sampleListing, vectorSimilarity: 0.9 },
      { listing: boostedListing, vectorSimilarity: 0.8 },
    ]);
    vi.mocked(scoreListingsAgainstQuery).mockResolvedValue(
      new Map([
        ["def", { overlap: 3, matched: { areas: ["koramangala"], amenities: [], deskTypes: [], landmarks: [], budgetSignals: [] } }],
      ]),
    );

    const res = await postSearch({ query: "quiet cabin near metro" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      interpretedQuery: "Private cabin · Metro",
      listings: [boostedListing, sampleListing].map(toPublicListing),
      matchedEntities: {
        areas: ["koramangala"],
        amenities: [],
        deskTypes: [],
        landmarks: [],
        budgetSignals: [],
      },
    });
    expect(rewriteSearchQuery).toHaveBeenCalledWith("quiet cabin near metro");
    expect(scoreListingsAgainstQuery).toHaveBeenCalledWith(
      ["abc", "def"],
      {
        areas: ["koramangala"],
        amenities: [],
        deskTypes: [],
        landmarks: [],
        budgetSignals: [],
      },
    );
    expect(embedTexts).toHaveBeenCalledWith(["Private cabin · Metro"], "query");
    expect(searchListingsByEmbedding).toHaveBeenCalledWith([0.1, 0.2, 0.3], 20);
  });

  it("emits search_performed through the portal pipeline rather than writing search_queries", async () => {
    vi.mocked(rewriteSearchQuery).mockResolvedValue("Private cabin · Metro");
    vi.mocked(extractSearchEntities).mockResolvedValue({
      areas: ["koramangala"],
      amenities: [],
      deskTypes: [],
      landmarks: [],
      budgetSignals: [],
    });
    vi.mocked(embedTexts).mockResolvedValue([[0.1, 0.2, 0.3]]);
    vi.mocked(searchListingsByEmbedding).mockResolvedValue([
      { listing: sampleListing, vectorSimilarity: 0.9 },
    ]);
    vi.mocked(scoreListingsAgainstQuery).mockResolvedValue(new Map());

    const res = await postSearch({ query: "hsr layout 20 desks" });
    expect(res.status).toBe(200);
    expect(emitSearchPerformed).toHaveBeenCalledTimes(1);
    const [input] = emitSearchPerformed.mock.calls[0];
    expect(input.query).toBe("hsr layout 20 desks");
    expect(input.sessionId).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(res.headers.get("set-cookie")).toContain("gs_sid=");
  });

  it("masks listing privacy fields in the JSON payload", async () => {
    vi.mocked(rewriteSearchQuery).mockResolvedValue("Private cabin · Metro");
    vi.mocked(extractSearchEntities).mockResolvedValue({
      areas: ["koramangala"],
      amenities: [],
      deskTypes: [],
      landmarks: [],
      budgetSignals: [],
    });
    vi.mocked(embedTexts).mockResolvedValue([[0.1, 0.2, 0.3]]);
    vi.mocked(searchListingsByEmbedding).mockResolvedValue([
      { listing: sampleListing, vectorSimilarity: 0.9 },
      { listing: boostedListing, vectorSimilarity: 0.8 },
    ]);
    vi.mocked(scoreListingsAgainstQuery).mockResolvedValue(
      new Map([
        ["def", { overlap: 3, matched: { areas: ["koramangala"], amenities: [], deskTypes: [], landmarks: [], budgetSignals: [] } }],
      ]),
    );

    const res = await postSearch({ query: "quiet cabin near metro" });

    expect(res.status).toBe(200);
    const body = await res.json();
    const raw = JSON.stringify(body.listings);
    expect(raw).not.toMatch(/"address"/);
    expect(raw).not.toMatch(/"pricingHint"/);
    expect(raw).not.toMatch(/"sourceUrl"/);
    expect(raw).not.toMatch(/"sourceId"/);
    expect(raw).not.toMatch(/"lat"/);
    expect(raw).not.toMatch(/"lng"/);
    expect(raw).toMatch(/"approxLat"/);
  });

  it("returns vector order when graph boost fails", async () => {
    vi.mocked(rewriteSearchQuery).mockResolvedValue("Private cabin · Metro");
    vi.mocked(extractSearchEntities).mockResolvedValue({
      areas: ["koramangala"],
      amenities: [],
      deskTypes: [],
      landmarks: [],
      budgetSignals: [],
    });
    vi.mocked(embedTexts).mockResolvedValue([[0.1, 0.2, 0.3]]);
    vi.mocked(searchListingsByEmbedding).mockResolvedValue([
      { listing: sampleListing, vectorSimilarity: 0.9 },
      { listing: boostedListing, vectorSimilarity: 0.8 },
    ]);
    vi.mocked(scoreListingsAgainstQuery).mockRejectedValue(new Error("age down"));

    const res = await postSearch({ query: "quiet cabin near metro" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      interpretedQuery: "Private cabin · Metro",
      listings: [sampleListing, boostedListing].map(toPublicListing),
      matchedEntities: {
        areas: ["koramangala"],
        amenities: [],
        deskTypes: [],
        landmarks: [],
        budgetSignals: [],
      },
    });
  });
});
