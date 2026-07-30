import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const release = vi.fn();
const connect = vi.fn(async () => ({ query, release }));

vi.mock("../db/client", () => ({
  getPool: () => ({ connect }),
}));

import { emptyQueryEntities } from "./types";
import {
  ensureAgeSession,
  isAgeAvailable,
  scoreListingsAgainstQuery,
  sanitizeCypherLiteral,
  upsertListingGraph,
  wipeGentleSpaceGraph,
} from "./age";

beforeEach(() => {
  query.mockReset();
  release.mockReset();
  connect.mockClear();
  delete process.env.DATABASE_URL;
});

describe("ensureAgeSession", () => {
  it("loads age and sets the search path", async () => {
    await ensureAgeSession({ query } as never);

    expect(query).toHaveBeenNthCalledWith(1, "LOAD 'age'");
    expect(query).toHaveBeenNthCalledWith(
      2,
      'SET search_path TO ag_catalog, "$user", public',
    );
  });
});

describe("sanitizeCypherLiteral", () => {
  it("allows safe cypher literals", () => {
    expect(sanitizeCypherLiteral("Owner's Club")).toBe("Owner's Club");
  });

  it("rejects $$ breakout attempts", () => {
    expect(() => sanitizeCypherLiteral("bad $$ literal")).toThrow("unsafe cypher literal");
  });

  it("rejects backslashes and control characters", () => {
    expect(() => sanitizeCypherLiteral("bad\\literal")).toThrow("unsafe cypher literal");
    expect(() => sanitizeCypherLiteral("bad\u0007literal")).toThrow("unsafe cypher literal");
  });
});

describe("isAgeAvailable", () => {
  it("returns false when age checks throw", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockRejectedValueOnce(new Error("boom"));

    await expect(isAgeAvailable()).resolves.toBe(false);
  });

  it("returns false when pool connect rejects", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    connect.mockRejectedValueOnce(new Error("connect failed"));

    await expect(isAgeAvailable()).resolves.toBe(false);
    expect(release).not.toHaveBeenCalled();
  });
});

describe("wipeGentleSpaceGraph", () => {
  it("deletes all graph nodes", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });

    await wipeGentleSpaceGraph();

    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("MATCH (n) DETACH DELETE n"),
    );
  });
});

describe("upsertListingGraph", () => {
  it("escapes single quotes in cypher literals", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });

    await upsertListingGraph({
      id: "550e8400-e29b-41d4-a716-446655440000",
      slug: "owners-club",
      title: "Owner's Club",
      entities: {
        ...emptyQueryEntities(),
        areas: ["Koramangala"],
        amenities: ["O'Reilly WiFi"],
      },
    });

    expect(query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("Owner''s Club"),
    );
    expect(query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("o''reilly wifi"),
    );
  });
});

describe("scoreListingsAgainstQuery", () => {
  it("scores overlap per bucket from graph rows", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            listing_id: '"listing-1"',
            rel: '"IN_AREA"',
            elabel: '"Area"',
            name: '"Koramangala"',
          },
          {
            listing_id: '"listing-1"',
            rel: '"HAS_AMENITY"',
            elabel: '"Amenity"',
            name: '"WiFi"',
          },
          {
            listing_id: '"listing-2"',
            rel: '"HAS_BUDGET"',
            elabel: '"BudgetSignal"',
            name: '"Under_15k"',
          },
          {
            listing_id: '"listing-2"',
            rel: '"HAS_AMENITY"',
            elabel: '"Amenity"',
            name: '"Printer"',
          },
        ],
      });

    const scored = await scoreListingsAgainstQuery(["listing-1", "listing-2"], {
      areas: ["koramangala"],
      amenities: ["wifi", "aircon"],
      deskTypes: [],
      landmarks: [],
      budgetSignals: ["under_15k"],
    });

    expect(scored.get("listing-1")).toEqual({
      overlap: 4,
      matched: {
        areas: ["koramangala"],
        amenities: ["wifi"],
        deskTypes: [],
        landmarks: [],
        budgetSignals: [],
      },
    });
    expect(scored.get("listing-2")).toEqual({
      overlap: 2,
      matched: {
        areas: [],
        amenities: [],
        deskTypes: [],
        landmarks: [],
        budgetSignals: ["under_15k"],
      },
    });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining(`l.id IN ['listing-1', 'listing-2']`),
    );
  });

  it("returns an empty map for an empty query", async () => {
    process.env.DATABASE_URL = "postgres://local/test";

    const scored = await scoreListingsAgainstQuery(["listing-1"], emptyQueryEntities());

    expect(scored.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
