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
  replaceListingGraph: vi.fn(),
  upsertListingGraph: vi.fn(),
  wipeGentleSpaceGraph: vi.fn(),
}));

import { extractSearchEntities, isAiSearchConfigured } from "@/lib/ai/client";
import { listListings } from "@/lib/db/listings";
import { buildListingEmbeddingText } from "@/lib/listings/embedding-text";
import {
  isAgeAvailable,
  replaceListingGraph,
  upsertListingGraph,
  wipeGentleSpaceGraph,
} from "./age";
import { rebuildListingGraph, syncListingGraph } from "./rebuild";

const sampleListing = {
  id: "listing-1",
  source: "coworker" as const,
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
};

beforeEach(() => {
  vi.mocked(extractSearchEntities).mockReset();
  vi.mocked(isAiSearchConfigured).mockReset();
  vi.mocked(listListings).mockReset();
  vi.mocked(buildListingEmbeddingText).mockReset();
  vi.mocked(isAgeAvailable).mockReset();
  vi.mocked(replaceListingGraph).mockReset();
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
    vi.mocked(listListings).mockResolvedValue([sampleListing]);
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
      { ...sampleListing, amenities: ["WiFi"] },
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

describe("syncListingGraph", () => {
  it("skips when AI search or AGE is unavailable", async () => {
    vi.mocked(isAiSearchConfigured).mockReturnValue(false);

    await expect(syncListingGraph([sampleListing])).resolves.toEqual({ listings: 0, skipped: true });

    expect(isAgeAvailable).not.toHaveBeenCalled();
    expect(extractSearchEntities).not.toHaveBeenCalled();
    expect(replaceListingGraph).not.toHaveBeenCalled();
  });

  it("extracts all changed listings before the first graph mutation", async () => {
    vi.mocked(isAiSearchConfigured).mockReturnValue(true);
    vi.mocked(isAgeAvailable).mockResolvedValue(true);
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
      .mockResolvedValueOnce({
        areas: ["Indiranagar"],
        amenities: ["AC"],
        deskTypes: ["Private Office"],
        landmarks: [],
        budgetSignals: ["under_20k"],
      });

    const changed = [
      sampleListing,
      {
        ...sampleListing,
        id: "listing-2",
        sourceId: "source-2",
        slug: "indiranagar-spot",
        title: "Indiranagar Spot",
        address: "100 Feet Road",
        area: "Indiranagar",
        amenities: ["AC"],
        pricingHint: "under 20k",
        propertyType: "Private Office",
        sourceUrl: "https://example.com/listing-2",
      },
    ];

    await expect(syncListingGraph(changed)).resolves.toEqual({ listings: 2, skipped: false });

    expect(replaceListingGraph).toHaveBeenCalledTimes(2);
    const firstReplaceCall = vi.mocked(replaceListingGraph).mock.invocationCallOrder[0];
    const secondExtractCall = vi.mocked(extractSearchEntities).mock.invocationCallOrder[1];
    expect(secondExtractCall).toBeLessThan(firstReplaceCall);
    expect(replaceListingGraph).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "listing-1" }),
    );
    expect(replaceListingGraph).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "listing-2" }),
    );
    expect(wipeGentleSpaceGraph).not.toHaveBeenCalled();
    expect(upsertListingGraph).not.toHaveBeenCalled();
  });

  it("does not mutate AGE for soft-hidden rows when no changed listings are passed", async () => {
    vi.mocked(isAiSearchConfigured).mockReturnValue(true);
    vi.mocked(isAgeAvailable).mockResolvedValue(true);

    await expect(syncListingGraph([])).resolves.toEqual({ listings: 0, skipped: false });

    expect(extractSearchEntities).not.toHaveBeenCalled();
    expect(replaceListingGraph).not.toHaveBeenCalled();
  });
});
