import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("./client", () => ({
  getPool: () => ({ query }),
}));

import {
  listListingEntityHashes,
  listListingExtractedEntities,
  updateListingExtractedEntities,
} from "./listings";

beforeEach(() => {
  query.mockReset();
  delete process.env.DATABASE_URL;
});

describe("listListingEntityHashes", () => {
  it("returns an empty map when DATABASE_URL is unset", async () => {
    await expect(listListingEntityHashes()).resolves.toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });

  it("selects hashes for visible listings", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValue({
      rows: [
        { id: "a", entities_hash: "hash-a" },
        { id: "b", entities_hash: null },
      ],
    });

    const result = await listListingEntityHashes();

    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("entities_hash");
    expect(sql).toContain("missing_runs < $1");
    expect(result).toEqual(new Map([["a", "hash-a"], ["b", null]]));
  });
});

describe("updateListingExtractedEntities", () => {
  it("stores the serialized entities and hash", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValue({ rows: [] });

    await updateListingExtractedEntities(
      "listing-1",
      {
        areas: ["Indiranagar"],
        amenities: ["WiFi"],
        deskTypes: ["Hot Desk"],
        landmarks: ["Metro"],
        budgetSignals: ["Premium"],
      },
      "hash-1",
    );

    const sql = query.mock.calls[0]?.[0] as string;
    expect(query).toHaveBeenCalledWith(sql, [
      JSON.stringify({
        areas: ["Indiranagar"],
        amenities: ["WiFi"],
        deskTypes: ["Hot Desk"],
        landmarks: ["Metro"],
        budgetSignals: ["Premium"],
      }),
      "hash-1",
      "listing-1",
    ]);
    expect(sql).toContain("SET extracted_entities = $1::jsonb, entities_hash = $2");
    expect(sql).toContain("WHERE id = $3");
  });
});

describe("listListingExtractedEntities", () => {
  it("returns an empty map when DATABASE_URL is unset", async () => {
    await expect(listListingExtractedEntities()).resolves.toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });

  it("parses only non-null rows through parseExtractedEntities", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValue({
      rows: [
        {
          id: "a",
          extracted_entities: {
            areas: ["Indiranagar"],
            amenities: ["WiFi"],
            deskTypes: ["Standing"],
            landmarks: ["Metro"],
            budgetSignals: ["Budget"],
          },
        },
        { id: "b", extracted_entities: null },
      ],
    });

    const result = await listListingExtractedEntities();

    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("extracted_entities IS NOT NULL");
    expect(sql).toContain("missing_runs < $1");
    expect(result).toEqual(
      new Map([
        [
          "a",
          {
            areas: ["indiranagar"],
            amenities: ["wifi"],
            deskTypes: ["standing"],
            landmarks: ["metro"],
            budgetSignals: ["budget"],
          },
        ],
      ]),
    );
    expect(result.has("b")).toBe(false);
  });
});
