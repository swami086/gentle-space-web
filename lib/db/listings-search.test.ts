import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("./client", () => ({
  getPool: () => ({ query }),
}));

import {
  searchListingsByEmbedding,
  updateListingEmbedding,
} from "./listings";

const sampleRow = {
  id: "abc",
  source: "coworker" as const,
  source_id: "c1",
  slug: "wework-prestige",
  title: "WeWork Prestige",
  description: "A space",
  short_teaser: "A space",
  address: "Koramangala",
  area: "Koramangala",
  city: "Bengaluru",
  lat: 12.93,
  lng: 77.62,
  amenities: ["WiFi"],
  images: ["https://example.com/img.jpg"],
  pricing_hint: "₹5000",
  property_type: "Coworking",
  source_url: "https://example.com/wework",
  synced_at: new Date("2026-01-01T00:00:00Z"),
  embedding: "[0.1,0.2,0.3]",
};

beforeEach(() => {
  query.mockReset();
  delete process.env.DATABASE_URL;
});

describe("searchListingsByEmbedding", () => {
  it("returns [] when DATABASE_URL is unset", async () => {
    const results = await searchListingsByEmbedding([0.1, 0.2, 0.3]);
    expect(results).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("queries pgvector cosine distance and maps rows", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValue({
      rows: [{ ...sampleRow, vector_similarity: 0.83 }],
    });

    const results = await searchListingsByEmbedding([0.1, 0.2, 0.3], 5);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        "SELECT *, (1 - (embedding <=> $1::vector))::float8 AS vector_similarity",
      ),
      ["[0.1,0.2,0.3]", 5],
    );
    expect(results).toHaveLength(1);
    expect(results[0].listing.slug).toBe("wework-prestige");
    expect(results[0].vectorSimilarity).toBe(0.83);
    expect(results[0].listing).not.toHaveProperty("embedding");
  });
});

describe("updateListingEmbedding", () => {
  it("updates embedding column via vector cast", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValue({ rows: [] });

    await updateListingEmbedding("abc", [0.4, 0.5, 0.6]);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE listings SET embedding = $1::vector"),
      ["[0.4,0.5,0.6]", "abc"],
    );
  });
});
