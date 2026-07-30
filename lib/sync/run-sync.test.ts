import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawListing } from "./sources/types";

const adapters = vi.hoisted(() => ({
  coworker: {
    source: "coworker" as const,
    discover: vi.fn(),
    fetchDetail: vi.fn(),
  },
  myhq: {
    source: "myhq" as const,
    discover: vi.fn(),
    fetchDetail: vi.fn(),
  },
  cofynd: {
    source: "cofynd" as const,
    discover: vi.fn(),
    fetchDetail: vi.fn(),
  },
  gofloaters: {
    source: "gofloaters" as const,
    discover: vi.fn(),
    fetchDetail: vi.fn(),
  },
}));

vi.mock("../db/listings", () => ({
  applySourceSync: vi.fn(),
  countVisibleListings: vi.fn(),
  listExistingForSource: vi.fn(),
}));

vi.mock("../db/sync-runs", () => ({
  startSyncRun: vi.fn(),
  finishSyncRun: vi.fn(),
}));

vi.mock("./embed-listings", () => ({
  embedListingsMissingEmbedding: vi.fn(),
}));

vi.mock("../graph/rebuild", () => ({
  syncListingGraph: vi.fn(),
}));

vi.mock("./sources", () => ({
  coworkerAdapter: adapters.coworker,
  myhqAdapter: adapters.myhq,
  cofyndAdapter: adapters.cofynd,
  gofloatersAdapter: adapters.gofloaters,
}));

import {
  applySourceSync,
  countVisibleListings,
  listExistingForSource,
} from "../db/listings";
import { finishSyncRun, startSyncRun } from "../db/sync-runs";
import { syncListingGraph } from "../graph/rebuild";
import { embedListingsMissingEmbedding } from "./embed-listings";
import { runListingsSync } from "./run-sync";

const { coworker, cofynd, gofloaters, myhq } = adapters;

const rawListing = (over: Partial<RawListing> = {}): RawListing => ({
  source: "coworker",
  sourceId: "c1",
  title: "WeWork Prestige",
  description: "A space",
  shortTeaser: "A space",
  address: "Koramangala",
  area: "Koramangala",
  city: "Bengaluru",
  lat: 12.93,
  lng: 77.62,
  amenities: ["WiFi"],
  images: ["https://example.com/img.jpg"],
  pricingHint: "5000 INR",
  propertyType: "Coworking",
  sourceUrl: "https://example.com/wework",
  ...over,
});

beforeEach(() => {
  vi.mocked(startSyncRun).mockReset();
  vi.mocked(finishSyncRun).mockReset();
  vi.mocked(applySourceSync).mockReset();
  vi.mocked(countVisibleListings).mockReset();
  vi.mocked(listExistingForSource).mockReset();
  vi.mocked(embedListingsMissingEmbedding).mockReset();
  vi.mocked(syncListingGraph).mockReset();

  vi.mocked(coworker.discover).mockReset();
  vi.mocked(coworker.fetchDetail).mockReset();
  vi.mocked(myhq.discover).mockReset();
  vi.mocked(myhq.fetchDetail).mockReset();
  vi.mocked(cofynd.discover).mockReset();
  vi.mocked(cofynd.fetchDetail).mockReset();
  vi.mocked(gofloaters.discover).mockReset();
  vi.mocked(gofloaters.fetchDetail).mockReset();

  vi.mocked(startSyncRun).mockResolvedValue(undefined);
  vi.mocked(finishSyncRun).mockResolvedValue(undefined);
  vi.mocked(countVisibleListings).mockResolvedValue(0);
  vi.mocked(embedListingsMissingEmbedding).mockResolvedValue(0);
  vi.mocked(syncListingGraph).mockResolvedValue({ listings: 0, skipped: true });
});

describe("runListingsSync", () => {
  it("upserts one successful source while leaving a failed source untouched", async () => {
    vi.mocked(coworker.discover).mockRejectedValue(new Error("network"));
    vi.mocked(cofynd.discover).mockResolvedValue([{ sourceId: "c1", url: "https://cofynd/c1" }]);
    vi.mocked(cofynd.fetchDetail).mockResolvedValue(rawListing({ source: "cofynd", sourceId: "c1" }));
    vi.mocked(listExistingForSource).mockResolvedValue([]);
    vi.mocked(applySourceSync).mockResolvedValue({
      inserted: 1,
      updated: 0,
      unchanged: 0,
      graphListings: [],
      newlyHiddenIds: [],
    });
    vi.mocked(countVisibleListings).mockResolvedValue(1);

    const run = await runListingsSync({
      adapters: [coworker, cofynd],
      skipDownstream: true,
      now: new Date("2026-07-30T00:00:00Z"),
    });

    expect(run.status).toBe("success");
    expect(run.sources.coworker?.status).toBe("failed");
    expect(run.sources.cofynd).toMatchObject({ status: "success", scraped: 1, inserted: 1 });
    expect(applySourceSync).toHaveBeenCalledOnce();
  });

  it("touches a fresh listing without calling Firecrawl detail scrape", async () => {
    vi.mocked(cofynd.discover).mockResolvedValue([{ sourceId: "c1", url: "https://cofynd/c1" }]);
    vi.mocked(listExistingForSource).mockResolvedValue([
      {
        sourceId: "c1",
        id: "id",
        slug: "slug",
        syncedAt: new Date("2026-07-29T00:00:00Z"),
        contentHash: "content",
        embedHash: "embed",
        missingRuns: 0,
      },
    ]);
    vi.mocked(applySourceSync).mockResolvedValue({
      inserted: 0,
      updated: 0,
      unchanged: 0,
      graphListings: [],
      newlyHiddenIds: [],
    });
    vi.mocked(countVisibleListings).mockResolvedValue(1);

    const run = await runListingsSync({
      adapters: [cofynd],
      skipDownstream: true,
      now: new Date("2026-07-30T00:00:00Z"),
    });

    expect(cofynd.fetchDetail).not.toHaveBeenCalled();
    expect(applySourceSync).toHaveBeenCalledWith(
      expect.objectContaining({ discoveredSourceIds: ["c1"], scraped: [] }),
    );
    expect(run.sources.cofynd?.scraped).toBe(0);
  });

  it("does not count an empty discovery as a successful missing run", async () => {
    vi.mocked(cofynd.discover).mockResolvedValue([]);
    vi.mocked(countVisibleListings).mockResolvedValue(10);

    const run = await runListingsSync({ adapters: [cofynd], skipDownstream: true });

    expect(run.status).toBe("failed");
    expect(applySourceSync).not.toHaveBeenCalled();
    expect(run.sources.cofynd?.error).toMatch(/zero URLs/);
  });

  it("limits detail scrapes while still touching every discovered sourceId", async () => {
    vi.mocked(cofynd.discover).mockResolvedValue([
      { sourceId: "c1", url: "https://cofynd/c1" },
      { sourceId: "c2", url: "https://cofynd/c2" },
    ]);
    vi.mocked(listExistingForSource).mockResolvedValue([]);
    vi.mocked(cofynd.fetchDetail).mockResolvedValue(rawListing({ source: "cofynd", sourceId: "c1" }));
    vi.mocked(applySourceSync).mockResolvedValue({
      inserted: 1,
      updated: 0,
      unchanged: 0,
      graphListings: [],
      newlyHiddenIds: [],
    });
    vi.mocked(countVisibleListings).mockResolvedValue(1);

    const run = await runListingsSync({
      adapters: [cofynd],
      maxDetailScrapes: 1,
      skipDownstream: true,
      now: new Date("2026-07-30T00:00:00Z"),
    });

    expect(run.status).toBe("success");
    expect(cofynd.fetchDetail).toHaveBeenCalledOnce();
    expect(applySourceSync).toHaveBeenCalledWith(
      expect.objectContaining({
        discoveredSourceIds: ["c1", "c2"],
        scraped: [
          expect.objectContaining({
            listing: expect.objectContaining({ sourceId: "c1" }),
          }),
        ],
      }),
    );
  });

  it("finishes the run as failed when a post-write step throws", async () => {
    vi.mocked(cofynd.discover).mockResolvedValue([{ sourceId: "c1", url: "https://cofynd/c1" }]);
    vi.mocked(cofynd.fetchDetail).mockResolvedValue(rawListing({ source: "cofynd", sourceId: "c1" }));
    vi.mocked(listExistingForSource).mockResolvedValue([]);
    vi.mocked(applySourceSync).mockResolvedValue({
      inserted: 1,
      updated: 0,
      unchanged: 0,
      graphListings: [],
      newlyHiddenIds: [],
    });
    vi.mocked(countVisibleListings).mockRejectedValue(new Error("count failed"));

    const run = await runListingsSync({
      adapters: [cofynd],
      skipDownstream: true,
      now: new Date("2026-07-30T00:00:00Z"),
    });

    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/count failed/);
    expect(run.sources.cofynd?.status).toBe("success");
    expect(finishSyncRun).toHaveBeenLastCalledWith(
      expect.any(String),
      "failed",
      null,
      "count failed",
      expect.objectContaining({
        cofynd: expect.objectContaining({ status: "success" }),
      }),
    );
  });

  it("soft-fails downstream hooks after a successful source write", async () => {
    vi.mocked(cofynd.discover).mockResolvedValue([{ sourceId: "c1", url: "https://cofynd/c1" }]);
    const changedListing = {
      ...rawListing({ source: "cofynd", sourceId: "c1" }),
      id: "listing-1",
      slug: "wework-prestige",
      syncedAt: "2026-07-30T00:00:00.000Z",
    };
    vi.mocked(cofynd.fetchDetail).mockResolvedValue(rawListing({ source: "cofynd", sourceId: "c1" }));
    vi.mocked(listExistingForSource).mockResolvedValue([]);
    vi.mocked(applySourceSync).mockResolvedValue({
      inserted: 1,
      updated: 0,
      unchanged: 0,
      graphListings: [changedListing],
      newlyHiddenIds: [],
    });
    vi.mocked(countVisibleListings).mockResolvedValue(1);
    vi.mocked(embedListingsMissingEmbedding).mockRejectedValueOnce(new Error("embed failed"));

    const run = await runListingsSync({
      adapters: [cofynd],
      now: new Date("2026-07-30T00:00:00Z"),
    });

    expect(run.status).toBe("success");
    expect(embedListingsMissingEmbedding).toHaveBeenCalledOnce();
    expect(syncListingGraph).toHaveBeenCalledWith([changedListing]);
  });
});
