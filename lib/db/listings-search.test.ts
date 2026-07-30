import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("./client", () => ({
  getPool: () => ({ query }),
}));

import {
  getListingBySlug,
  listListings,
  listListingsMissingEmbedding,
  searchListingsByEmbedding,
  updateListingEmbeddings,
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
  missing_runs: 0,
  structured_embedding: "[0.1,0.2,0.3]",
  description_embedding: "[0.4,0.5,0.6]",
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

  it("queries the max of both column similarities and maps rows", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValue({
      rows: [{ ...sampleRow, vector_similarity: 0.83 }],
    });

    const results = await searchListingsByEmbedding([0.1, 0.2, 0.3], 5);

    const sql = query.mock.calls[0]?.[0] as string;
    expect(query).toHaveBeenCalledWith(sql, ["[0.1,0.2,0.3]", 3, 20]);
    expect(sql).toContain("GREATEST(");
    expect(sql).toContain("structured_embedding <=> $1::vector");
    expect(sql).toContain("description_embedding <=> $1::vector");
    expect(sql).toContain("AS vector_similarity");
    expect(sql).toContain(
      "WHERE (structured_embedding IS NOT NULL OR description_embedding IS NOT NULL)",
    );
    expect(sql).toContain("missing_runs < $2");
    expect(sql).toContain("ORDER BY vector_similarity DESC");
    expect(results).toHaveLength(1);
    expect(results[0].listing.slug).toBe("wework-prestige");
    expect(results[0].vectorSimilarity).toBe(0.83);
    expect(results[0].listing).not.toHaveProperty("structured_embedding");
    expect(results[0].listing).not.toHaveProperty("description_embedding");
  });
});

describe("visibility-filtered reads", () => {
  it("keeps listListings scoped to visible rows", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValue({ rows: [sampleRow] });

    const results = await listListings();

    expect(query.mock.calls[0]?.[0]).toContain("missing_runs < $1");
    expect(results).toHaveLength(1);
    expect(results[0]?.slug).toBe("wework-prestige");
  });

  it("keeps getListingBySlug scoped to visible rows", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValue({ rows: [sampleRow] });

    const result = await getListingBySlug("wework-prestige");

    expect(query.mock.calls[0]?.[0]).toContain("missing_runs < $2");
    expect(result?.slug).toBe("wework-prestige");
  });
});

describe("listListingsMissingEmbedding", () => {
  it("selects rows where either embedding column is null", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValue({ rows: [sampleRow] });

    const results = await listListingsMissingEmbedding();

    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("structured_embedding IS NULL OR description_embedding IS NULL");
    expect(sql).toContain("missing_runs < $1");
    expect(results).toHaveLength(1);
  });
});

describe("updateListingEmbeddings", () => {
  it("updates both embedding columns via vector cast", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValue({ rows: [] });

    await updateListingEmbeddings("abc", {
      structured: [0.4, 0.5, 0.6],
      description: [0.7, 0.8, 0.9],
    });

    const sql = query.mock.calls[0]?.[0] as string;
    expect(query).toHaveBeenCalledWith(sql, ["[0.4,0.5,0.6]", "[0.7,0.8,0.9]", "abc"]);
    expect(sql).toContain("structured_embedding = $1::vector");
    expect(sql).toContain("description_embedding = $2::vector");
  });
});
