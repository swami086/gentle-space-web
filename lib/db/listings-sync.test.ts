import { beforeEach, expect, it, vi } from "vitest";

const query = vi.fn();
const release = vi.fn();
const connect = vi.fn(async () => ({ query, release }));

vi.mock("./client", () => ({
  getPool: () => ({ connect, query }),
}));

import { applySourceSync } from "./listings";

beforeEach(() => {
  query.mockReset();
  release.mockReset();
  connect.mockClear();
});

it("upserts scraped rows, touches every discovered id, and increments only unseen rows", async () => {
  query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: "stable-id", slug: "stable-slug" }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: "hidden-id", missing_runs: 3 }] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await applySourceSync({
    source: "coworker",
    discoveredSourceIds: ["seen", "scraped"],
    scraped: [
      {
        listing: {
          id: "stable-id",
          source: "coworker",
          sourceId: "scraped",
          slug: "stable-slug",
          title: "Space",
          description: "Description",
          shortTeaser: "Description",
          address: "Address",
          area: "Bellandur",
          city: "Bengaluru",
          lat: 12.9,
          lng: 77.6,
          amenities: ["WiFi"],
          images: [],
          pricingHint: null,
          propertyType: "Coworking",
          sourceUrl: "https://example.com/scraped",
          syncedAt: "2026-07-30T00:00:00.000Z",
        },
        contentHash: "content-new",
        embedHash: "embed-new",
        isNew: false,
        previousContentHash: "content-old",
        previousEmbedHash: "embed-old",
        wasHidden: false,
      },
    ],
    missingLimit: 3,
    trackMissing: true,
  });

  expect(result.updated).toBe(1);
  expect(result.newlyHiddenIds).toEqual(["hidden-id"]);
  expect(query.mock.calls[1][0]).toContain("ON CONFLICT (source, source_id)");
  // lat/lng are derived from address/area, so a changed address must clear them and let
  // the geocode hook re-derive. Keeping stale coords leaves the pin at the old building.
  expect(query.mock.calls[1][0]).toContain("listings.address IS DISTINCT FROM EXCLUDED.address");
  expect(query.mock.calls[1][0]).toContain("listings.area IS DISTINCT FROM EXCLUDED.area");
  expect(query.mock.calls[1][0]).toContain("THEN NULL ELSE listings.lat");
  expect(query.mock.calls[1][0]).toContain("THEN NULL ELSE listings.lng");
  expect(query.mock.calls[1][0]).toContain("THEN NULL ELSE listings.structured_embedding");
  expect(query.mock.calls[1][0]).toContain("THEN NULL ELSE listings.description_embedding");
  expect(query.mock.calls[2][0]).toContain("missing_runs = 0");
  expect(query.mock.calls[2][0]).not.toContain("synced_at");
  expect(query.mock.calls[3][0]).toContain("missing_runs < $3");
  expect(release).toHaveBeenCalledOnce();
});

it("rolls back the complete source write on failure", async () => {
  query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error("write failed"));

  await expect(
    applySourceSync({
      source: "coworker",
      discoveredSourceIds: ["one"],
      scraped: [],
      missingLimit: 3,
      trackMissing: true,
    }),
  ).rejects.toThrow("write failed");

  expect(query).toHaveBeenCalledWith("ROLLBACK");
});

it("skips the missing-runs increment when trackMissing is false", async () => {
  query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await applySourceSync({
    source: "coworker",
    discoveredSourceIds: ["seen-only"],
    scraped: [],
    missingLimit: 3,
    trackMissing: false,
  });

  expect(result.newlyHiddenIds).toEqual([]);
  expect(query).toHaveBeenCalledTimes(3);
  expect(query.mock.calls.some((call) => String(call[0]).includes("missing_runs < $3"))).toBe(false);
  expect(release).toHaveBeenCalledOnce();
});
