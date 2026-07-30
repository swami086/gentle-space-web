import { expect, it, vi } from "vitest";

vi.mock("../db/listings", () => ({
  listListingsMissingEmbedding: vi.fn(),
  updateListingEmbedding: vi.fn(),
}));

vi.mock("../ai/client", () => ({
  embedTexts: vi.fn(),
}));

import { embedTexts } from "../ai/client";
import { listListingsMissingEmbedding, updateListingEmbedding } from "../db/listings";
import { embedListingsMissingEmbedding } from "./embed-listings";

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

it("embeds only rows whose embedding is null", async () => {
  vi.mocked(listListingsMissingEmbedding).mockResolvedValue([sampleListing]);
  vi.mocked(embedTexts).mockResolvedValue([[0.1, 0.2]]);

  await expect(embedListingsMissingEmbedding()).resolves.toBe(1);

  expect(listListingsMissingEmbedding).toHaveBeenCalledOnce();
  expect(updateListingEmbedding).toHaveBeenCalledWith(sampleListing.id, [0.1, 0.2]);
});
