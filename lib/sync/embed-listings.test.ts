import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../db/listings", () => ({
  listListingsMissingEmbedding: vi.fn(),
  updateListingEmbeddings: vi.fn(),
}));

vi.mock("../ai/client", () => ({
  embedTexts: vi.fn(),
}));

import { embedTexts } from "../ai/client";
import { listListingsMissingEmbedding, updateListingEmbeddings } from "../db/listings";
import { embedListingsMissingEmbedding } from "./embed-listings";

function makeListing(i: number) {
  return {
    id: `listing-${i}`,
    source: "coworker" as const,
    sourceId: `source-${i}`,
    slug: `koramangala-spot-${i}`,
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
    sourceUrl: `https://example.com/listing-${i}`,
    syncedAt: "2026-07-23T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

it("embeds structured and description texts per listing and de-interleaves the vectors", async () => {
  vi.mocked(listListingsMissingEmbedding).mockResolvedValue([makeListing(1)]);
  vi.mocked(embedTexts).mockResolvedValue([
    [0.1, 0.2],
    [0.3, 0.4],
  ]);

  await expect(embedListingsMissingEmbedding()).resolves.toBe(1);

  expect(embedTexts).toHaveBeenCalledWith([
    expect.stringContaining("Koramangala Spot"),
    expect.stringContaining("Bright workspace"),
  ]);
  expect(updateListingEmbeddings).toHaveBeenCalledWith("listing-1", {
    structured: [0.1, 0.2],
    description: [0.3, 0.4],
  });
});

it("sends 32 interleaved texts for a full 16-listing chunk", async () => {
  const listings = Array.from({ length: 16 }, (_, i) => makeListing(i));
  vi.mocked(listListingsMissingEmbedding).mockResolvedValue(listings);
  vi.mocked(embedTexts).mockResolvedValue(Array.from({ length: 32 }, (_, i) => [i]));

  await expect(embedListingsMissingEmbedding()).resolves.toBe(16);

  expect(embedTexts).toHaveBeenCalledTimes(1);
  expect(embedTexts.mock.calls[0][0]).toHaveLength(32);
  expect(updateListingEmbeddings).toHaveBeenCalledWith("listing-0", {
    structured: [0],
    description: [1],
  });
  expect(updateListingEmbeddings).toHaveBeenCalledWith("listing-15", {
    structured: [30],
    description: [31],
  });
});

it("rejects when embedTexts returns fewer vectors than interleaved texts", async () => {
  vi.mocked(listListingsMissingEmbedding).mockResolvedValue([makeListing(1), makeListing(2)]);
  vi.mocked(embedTexts).mockResolvedValue([[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]]);

  await expect(embedListingsMissingEmbedding()).rejects.toThrow(
    "embedTexts returned 3 vectors for 4 texts (2 listings)",
  );
  expect(updateListingEmbeddings).not.toHaveBeenCalled();
});

it("splits into multiple chunks when more than 16 listings need embedding", async () => {
  vi.useFakeTimers();
  const listings = Array.from({ length: 17 }, (_, i) => makeListing(i));
  vi.mocked(listListingsMissingEmbedding).mockResolvedValue(listings);
  vi.mocked(embedTexts)
    .mockResolvedValueOnce(Array.from({ length: 32 }, (_, i) => [i]))
    .mockResolvedValueOnce([[100], [101]]);

  const resultPromise = embedListingsMissingEmbedding();
  await vi.advanceTimersByTimeAsync(32_000);
  await expect(resultPromise).resolves.toBe(17);

  expect(embedTexts).toHaveBeenCalledTimes(2);
  expect(embedTexts.mock.calls[0][0]).toHaveLength(32);
  expect(embedTexts.mock.calls[1][0]).toHaveLength(2);
  expect(updateListingEmbeddings).toHaveBeenCalledWith("listing-16", {
    structured: [100],
    description: [101],
  });
});
