import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/client", () => ({
  extractSearchEntities: vi.fn(),
  isAiSearchConfigured: vi.fn(),
}));

vi.mock("@/lib/db/listings", () => ({
  listListings: vi.fn(),
}));

vi.mock("@/lib/listings/embedding-text", () => ({
  buildListingEmbeddingText: vi.fn(),
}));

vi.mock("./age", () => ({
  isAgeAvailable: vi.fn(),
  upsertListingGraph: vi.fn(),
  wipeGentleSpaceGraph: vi.fn(),
}));

import { extractSearchEntities, isAiSearchConfigured } from "@/lib/ai/client";
import { listListings } from "@/lib/db/listings";
import { buildListingEmbeddingText } from "@/lib/listings/embedding-text";
import { isAgeAvailable, upsertListingGraph, wipeGentleSpaceGraph } from "./age";
import { rebuildListingGraph } from "./rebuild";

beforeEach(() => {
  vi.mocked(extractSearchEntities).mockReset();
  vi.mocked(isAiSearchConfigured).mockReset();
  vi.mocked(listListings).mockReset();
  vi.mocked(buildListingEmbeddingText).mockReset();
  vi.mocked(isAgeAvailable).mockReset();
  vi.mocked(upsertListingGraph).mockReset();
  vi.mocked(wipeGentleSpaceGraph).mockReset();
});

describe("rebuildListingGraph", () => {
  it("skips when AI search or AGE is unavailable", async () => {
    vi.mocked(isAiSearchConfigured).mockReturnValue(false);

    await expect(rebuildListingGraph()).resolves.toEqual({ listings: 0, skipped: true });

    expect(isAgeAvailable).not.toHaveBeenCalled();
    expect(listListings).not.toHaveBeenCalled();
    expect(wipeGentleSpaceGraph).not.toHaveBeenCalled();
  });

  it("rebuilds and merges seeded SQL entities with LLM extract (budget from extract only)", async () => {
    vi.mocked(isAiSearchConfigured).mockReturnValue(true);
    vi.mocked(isAgeAvailable).mockResolvedValue(true);
    vi.mocked(listListings).mockResolvedValue([
      {
        id: "listing-1",
        source: "coworker",
        sourceId: "source-1",
        slug: "koramangala-spot",
        title: "Koramangala Spot",
        description: "A bright workspace",
        shortTeaser: "Bright workspace",
        address: "1st Block",
        area: "Koramangala",
        city: "Bengaluru",
        lat: 12.93,
        lng: 77.62,
        amenities: ["WiFi", "AC"],
        images: [],
        pricingHint: "under 15k",
        propertyType: "Coworking",
        sourceUrl: "https://example.com/listing-1",
        syncedAt: "2026-07-23T00:00:00.000Z",
      },
    ]);
    vi.mocked(buildListingEmbeddingText).mockReturnValue("Koramangala Spot · under 15k");
    vi.mocked(extractSearchEntities).mockResolvedValue({
      areas: ["Bengaluru", "Indiranagar", "koramangala"],
      amenities: ["wifi", "Printer"],
      deskTypes: ["Private Cabin"],
      landmarks: ["Metro"],
      budgetSignals: ["Under_15K"],
    });

    await expect(rebuildListingGraph()).resolves.toEqual({ listings: 1, skipped: false });

    expect(wipeGentleSpaceGraph).toHaveBeenCalledOnce();
    expect(buildListingEmbeddingText).toHaveBeenCalledOnce();
    expect(upsertListingGraph).toHaveBeenCalledWith({
      id: "listing-1",
      slug: "koramangala-spot",
      title: "Koramangala Spot",
      entities: {
        areas: ["koramangala", "bengaluru", "indiranagar"],
        amenities: ["wifi", "ac", "printer"],
        deskTypes: ["coworking", "private cabin"],
        landmarks: ["metro"],
        budgetSignals: ["under_15k"],
      },
    });
  });

  it("does not wipe the graph if extraction fails mid-run", async () => {
    vi.mocked(isAiSearchConfigured).mockReturnValue(true);
    vi.mocked(isAgeAvailable).mockResolvedValue(true);
    vi.mocked(listListings).mockResolvedValue([
      {
        id: "listing-1",
        source: "coworker",
        sourceId: "source-1",
        slug: "koramangala-spot",
        title: "Koramangala Spot",
        description: "A bright workspace",
        shortTeaser: "Bright workspace",
        address: "1st Block",
        area: "Koramangala",
        city: "Bengaluru",
        lat: 12.93,
        lng: 77.62,
        amenities: ["WiFi"],
        images: [],
        pricingHint: "under 15k",
        propertyType: "Coworking",
        sourceUrl: "https://example.com/listing-1",
        syncedAt: "2026-07-23T00:00:00.000Z",
      },
      {
        id: "listing-2",
        source: "coworker",
        sourceId: "source-2",
        slug: "indiranagar-spot",
        title: "Indiranagar Spot",
        description: "Another workspace",
        shortTeaser: "Another workspace",
        address: "100 Feet Road",
        area: "Indiranagar",
        city: "Bengaluru",
        lat: 12.97,
        lng: 77.64,
        amenities: ["AC"],
        images: [],
        pricingHint: "under 20k",
        propertyType: "Private Office",
        sourceUrl: "https://example.com/listing-2",
        syncedAt: "2026-07-23T00:00:00.000Z",
      },
    ]);
    vi.mocked(buildListingEmbeddingText)
      .mockReturnValueOnce("Koramangala Spot · under 15k")
      .mockReturnValueOnce("Indiranagar Spot · under 20k");
    vi.mocked(extractSearchEntities)
      .mockResolvedValueOnce({
        areas: ["Koramangala"],
        amenities: ["WiFi"],
        deskTypes: ["Coworking"],
        landmarks: [],
        budgetSignals: [],
      })
      .mockRejectedValueOnce(new Error("boom"));

    await expect(rebuildListingGraph()).rejects.toThrow("boom");

    expect(wipeGentleSpaceGraph).not.toHaveBeenCalled();
    expect(upsertListingGraph).not.toHaveBeenCalled();
  });
});
