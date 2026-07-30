import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/client", () => ({
  extractSearchEntitiesBatchStrict: vi.fn(),
  isAiSearchConfigured: vi.fn(),
}));

vi.mock("@/lib/db/listings", () => ({
  listListings: vi.fn(),
  listListingExtractedEntities: vi.fn(),
  updateListingExtractedEntities: vi.fn(),
}));

vi.mock("@/lib/listings/embedding-text", () => ({
  buildListingEmbeddingText: vi.fn(),
}));

vi.mock("@/lib/sync/content-hash", () => ({
  hashEmbeddingText: vi.fn(),
}));

vi.mock("@/lib/sync/pace", () => ({
  forEachChunkPaced: vi.fn(),
}));

vi.mock("./age", () => ({
  isAgeAvailable: vi.fn(),
  replaceListingGraphs: vi.fn(),
  upsertListingGraphs: vi.fn(),
  wipeGentleSpaceGraph: vi.fn(),
}));

import { extractSearchEntitiesBatchStrict, isAiSearchConfigured } from "@/lib/ai/client";
import {
  listListingExtractedEntities,
  listListings,
  updateListingExtractedEntities,
} from "@/lib/db/listings";
import { buildListingEmbeddingText } from "@/lib/listings/embedding-text";
import { hashEmbeddingText } from "@/lib/sync/content-hash";
import { forEachChunkPaced } from "@/lib/sync/pace";
import {
  isAgeAvailable,
  replaceListingGraphs,
  upsertListingGraphs,
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
  process.env.DATABASE_URL = "postgres://local/test";
  vi.mocked(extractSearchEntitiesBatchStrict).mockReset();
  vi.mocked(isAiSearchConfigured).mockReset();
  vi.mocked(listListingExtractedEntities).mockReset();
  vi.mocked(listListings).mockReset();
  vi.mocked(updateListingExtractedEntities).mockReset();
  vi.mocked(buildListingEmbeddingText).mockReset();
  vi.mocked(hashEmbeddingText).mockReset();
  vi.mocked(forEachChunkPaced).mockReset();
  vi.mocked(isAgeAvailable).mockReset();
  vi.mocked(replaceListingGraphs).mockReset();
  vi.mocked(upsertListingGraphs).mockReset();
  vi.mocked(wipeGentleSpaceGraph).mockReset();
  vi.mocked(forEachChunkPaced).mockImplementation(async (items, chunkSize, _itemsPerMinute, worker) => {
    for (let i = 0; i < items.length; i += chunkSize) {
      await worker(items.slice(i, i + chunkSize));
    }
  });
});

describe("rebuildListingGraph", () => {
  it("skips when DATABASE_URL or AGE is unavailable", async () => {
    delete process.env.DATABASE_URL;

    await expect(rebuildListingGraph()).resolves.toEqual({ listings: 0, skipped: true });

    expect(isAgeAvailable).not.toHaveBeenCalled();
    expect(listListings).not.toHaveBeenCalled();
    expect(wipeGentleSpaceGraph).not.toHaveBeenCalled();
  });

  it("rebuilds from SQL cache, merges with seeds, and never calls online extract", async () => {
    vi.mocked(isAgeAvailable).mockResolvedValue(true);
    vi.mocked(listListings).mockResolvedValue([sampleListing]);
    vi.mocked(listListingExtractedEntities).mockResolvedValue(
      new Map([
        [
          "listing-1",
          {
            areas: ["Bengaluru", "Indiranagar", "koramangala"],
            amenities: ["wifi", "Printer"],
            deskTypes: ["Private Cabin"],
            landmarks: ["Metro"],
            budgetSignals: ["Under_15K"],
          },
        ],
      ]),
    );

    await expect(rebuildListingGraph()).resolves.toEqual({ listings: 1, skipped: false });

    expect(wipeGentleSpaceGraph).toHaveBeenCalledOnce();
    expect(listListingExtractedEntities).toHaveBeenCalledOnce();
    expect(extractSearchEntitiesBatchStrict).not.toHaveBeenCalled();
    expect(buildListingEmbeddingText).not.toHaveBeenCalled();
    expect(upsertListingGraphs).toHaveBeenCalledWith([
      {
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
      },
    ]);
  });

  it("uses only seeded entities when a listing has no cached extraction", async () => {
    vi.mocked(isAgeAvailable).mockResolvedValue(true);
    vi.mocked(listListings).mockResolvedValue([sampleListing]);
    vi.mocked(listListingExtractedEntities).mockResolvedValue(new Map());

    await expect(rebuildListingGraph()).resolves.toEqual({ listings: 1, skipped: false });

    expect(upsertListingGraphs).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "listing-1",
        entities: {
          areas: ["koramangala", "bengaluru"],
          amenities: ["wifi", "ac"],
          deskTypes: ["coworking"],
          landmarks: [],
          budgetSignals: [],
        },
      }),
    ]);
  });
});

describe("syncListingGraph", () => {
  it("skips when AI search or AGE is unavailable", async () => {
    vi.mocked(isAiSearchConfigured).mockReturnValue(false);

    await expect(syncListingGraph([sampleListing])).resolves.toEqual({ listings: 0, skipped: true });

    expect(isAgeAvailable).not.toHaveBeenCalled();
    expect(extractSearchEntitiesBatchStrict).not.toHaveBeenCalled();
    expect(replaceListingGraphs).not.toHaveBeenCalled();
  });

  it("paces online extract, writes raw cache, then replaces merged graphs", async () => {
    vi.mocked(isAiSearchConfigured).mockReturnValue(true);
    vi.mocked(isAgeAvailable).mockResolvedValue(true);
    vi.mocked(buildListingEmbeddingText)
      .mockReturnValueOnce("Koramangala Spot · under 15k")
      .mockReturnValueOnce("Indiranagar Spot · under 20k");
    vi.mocked(hashEmbeddingText).mockReturnValueOnce("hash-1").mockReturnValueOnce("hash-2");
    vi.mocked(extractSearchEntitiesBatchStrict).mockResolvedValueOnce([
      {
        areas: ["Indiranagar"],
        amenities: ["WiFi"],
        deskTypes: ["Private Cabin"],
        landmarks: ["Metro"],
        budgetSignals: ["Under_15K"],
      },
      {
        areas: ["CBD"],
        amenities: ["Printer"],
        deskTypes: ["Private Office"],
        landmarks: ["UB City"],
        budgetSignals: ["Under_20K"],
      },
    ]);

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

    expect(forEachChunkPaced).toHaveBeenCalledOnce();
    expect(forEachChunkPaced).toHaveBeenCalledWith(changed, 50, 25, expect.any(Function));
    expect(buildListingEmbeddingText).toHaveBeenCalledTimes(2);
    expect(extractSearchEntitiesBatchStrict).toHaveBeenCalledOnce();
    expect(replaceListingGraphs).toHaveBeenCalledTimes(1);
    expect(extractSearchEntitiesBatchStrict).toHaveBeenCalledWith([
      "Koramangala Spot · under 15k",
      "Indiranagar Spot · under 20k",
    ]);
    expect(updateListingExtractedEntities).toHaveBeenNthCalledWith(1, "listing-1", {
      areas: ["Indiranagar"],
      amenities: ["WiFi"],
      deskTypes: ["Private Cabin"],
      landmarks: ["Metro"],
      budgetSignals: ["Under_15K"],
    }, "hash-1");
    expect(updateListingExtractedEntities).toHaveBeenNthCalledWith(2, "listing-2", {
      areas: ["CBD"],
      amenities: ["Printer"],
      deskTypes: ["Private Office"],
      landmarks: ["UB City"],
      budgetSignals: ["Under_20K"],
    }, "hash-2");
    const replaceCall = vi.mocked(replaceListingGraphs).mock.invocationCallOrder[0];
    const extractCall = vi.mocked(extractSearchEntitiesBatchStrict).mock.invocationCallOrder[0];
    const secondCacheWriteCall = vi.mocked(updateListingExtractedEntities).mock.invocationCallOrder[1];
    expect(extractCall).toBeLessThan(secondCacheWriteCall);
    expect(secondCacheWriteCall).toBeLessThan(replaceCall);
    expect(replaceListingGraphs).toHaveBeenCalledWith([
      {
        id: "listing-1",
        slug: "koramangala-spot",
        title: "Koramangala Spot",
        entities: {
          areas: ["koramangala", "bengaluru", "indiranagar"],
          amenities: ["wifi", "ac"],
          deskTypes: ["coworking", "private cabin"],
          landmarks: ["metro"],
          budgetSignals: ["under_15k"],
        },
      },
      {
        id: "listing-2",
        slug: "indiranagar-spot",
        title: "Indiranagar Spot",
        entities: {
          areas: ["indiranagar", "bengaluru", "cbd"],
          amenities: ["ac", "printer"],
          deskTypes: ["private office"],
          landmarks: ["ub city"],
          budgetSignals: ["under_20k"],
        },
      },
    ]);
    expect(wipeGentleSpaceGraph).not.toHaveBeenCalled();
    expect(upsertListingGraphs).not.toHaveBeenCalled();
  });

  it("does not mutate AGE for soft-hidden rows when no changed listings are passed", async () => {
    vi.mocked(isAiSearchConfigured).mockReturnValue(true);
    vi.mocked(isAgeAvailable).mockResolvedValue(true);

    await expect(syncListingGraph([])).resolves.toEqual({ listings: 0, skipped: false });

    expect(extractSearchEntitiesBatchStrict).not.toHaveBeenCalled();
    expect(replaceListingGraphs).not.toHaveBeenCalled();
  });
});
