import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  getPool: vi.fn(),
}));

import { getPool } from "./client";
import {
  applyListingEnrichment,
  insertEnrichmentLog,
  listEnrichmentCandidates,
  listRecentlyAcceptedEnrichmentIds,
} from "./listings";

const query = vi.fn();

beforeEach(() => {
  query.mockReset();
  vi.mocked(getPool).mockReturnValue({ query } as never);
  delete process.env.DATABASE_URL;
});

describe("listEnrichmentCandidates", () => {
  it("returns no rows without a database", async () => {
    await expect(listEnrichmentCandidates()).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("selects visible listing fields for weak checks", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValueOnce({ rows: [] });

    await listEnrichmentCandidates();

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("FROM listings");
    expect(sql).toContain("missing_runs <");
    expect(sql).toMatch(/source_url/i);
    expect(query.mock.calls[0][1]).toEqual([expect.any(Number)]);
  });
});

describe("listRecentlyAcceptedEnrichmentIds", () => {
  it("returns an empty map without a database", async () => {
    await expect(listRecentlyAcceptedEnrichmentIds(7)).resolves.toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });

  it("reads accepted enrichment log rows inside the cooldown window", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValueOnce({
      rows: [{ listing_id: "a", created_at: new Date("2026-07-30") }],
    });

    const map = await listRecentlyAcceptedEnrichmentIds(7);

    expect(map.get("a")).toBe("2026-07-30T00:00:00.000Z");
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("listing_enrichment_log");
    expect(sql).toContain("accepted = true");
    expect(query.mock.calls[0][1]).toEqual(["7"]);
  });
});

describe("applyListingEnrichment", () => {
  it("updates location fields and nulls derived location data", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValueOnce({ rowCount: 1 });

    await applyListingEnrichment("abc", {
      area: "HSR Layout",
      address: "",
      locationChanged: true,
      priceChanged: false,
    });

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("lat = NULL");
    expect(sql).toContain("lng = NULL");
    expect(sql).toContain("structured_embedding = NULL");
    expect(sql).toContain("embed_hash = NULL");
    expect(sql).not.toContain("COALESCE");
    expect(query.mock.calls[0][1]).toEqual(["HSR Layout", "", "abc"]);
  });

  it("clears embeddings but not coords on price-only change", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValueOnce({ rowCount: 1 });

    await applyListingEnrichment("abc", {
      pricingHint: "₹20,000/month",
      locationChanged: false,
      priceChanged: true,
    });

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("pricing_hint");
    expect(sql).toContain("structured_embedding = NULL");
    expect(sql).toContain("embed_hash = NULL");
    expect(sql).not.toContain("lat = NULL");
    expect(sql).not.toContain("COALESCE");
  });
});

describe("insertEnrichmentLog", () => {
  it("inserts into public.listing_enrichment_log", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValueOnce({ rowCount: 1 });

    await insertEnrichmentLog({
      listingId: "abc",
      pass: "page",
      accepted: true,
      payload: { locality: "HSR Layout" },
    });

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("public.listing_enrichment_log");
    expect(query.mock.calls[0][1][0]).toBe("abc");
    expect(query.mock.calls[0][1][3]).toBe(JSON.stringify({ locality: "HSR Layout" }));
  });
});
