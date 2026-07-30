import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredListing, RawListing } from "./sources/types";

vi.mock("../db/listings", () => ({
  fullReplaceListings: vi.fn(),
}));

vi.mock("../db/sync-runs", () => ({
  startSyncRun: vi.fn(),
  finishSyncRun: vi.fn(),
}));

vi.mock("./embed-listings", () => ({
  embedAllListings: vi.fn(),
}));

vi.mock("../graph/rebuild", () => ({
  rebuildListingGraph: vi.fn(),
}));

vi.mock("./sources", () => ({
  coworkerAdapter: { source: "coworker", discover: vi.fn(), fetchDetail: vi.fn() },
  myhqAdapter: { source: "myhq", discover: vi.fn(), fetchDetail: vi.fn() },
  cofyndAdapter: { source: "cofynd", discover: vi.fn(), fetchDetail: vi.fn() },
  gofloatersAdapter: { source: "gofloaters", discover: vi.fn(), fetchDetail: vi.fn() },
}));

import { fullReplaceListings } from "../db/listings";
import { finishSyncRun, startSyncRun } from "../db/sync-runs";
import { rebuildListingGraph } from "../graph/rebuild";
import { runListingsSync } from "./run-sync";
import { embedAllListings } from "./embed-listings";
import {
  cofyndAdapter,
  coworkerAdapter,
  gofloatersAdapter,
  myhqAdapter,
} from "./sources";

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
  pricingHint: "₹5000",
  propertyType: "Coworking",
  sourceUrl: "https://example.com/wework",
  ...over,
});

const makeListings = (count: number, source: RawListing["source"] = "coworker") =>
  Array.from({ length: count }, (_, i) =>
    rawListing({
      source,
      sourceId: `${source}-${i}`,
      title: `${source} Space ${i}`,
    }),
  );

const makeDiscovered = (
  count: number,
  source: RawListing["source"] = "coworker",
): DiscoveredListing[] =>
  Array.from({ length: count }, (_, i) => ({
    sourceId: `${source}-${i}`,
    url: `https://example.com/${source}/${i}`,
  }));

function mockDetailFetch(
  fetchDetail: (typeof coworkerAdapter)["fetchDetail"],
  source: RawListing["source"],
  discovered: DiscoveredListing[],
): void {
  vi.mocked(fetchDetail).mockImplementation(async (url: string) => {
    const match = discovered.find((item) => item.url === url);
    const suffix = match?.url.split("/").at(-1) ?? match?.sourceId ?? "0";
    return match
      ? rawListing({
          source,
          sourceId: match.sourceId,
          title: `${source} Space ${suffix}`,
          sourceUrl: match.url,
        })
      : null;
  });
}

beforeEach(() => {
  delete process.env.AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

  vi.mocked(startSyncRun).mockReset();
  vi.mocked(finishSyncRun).mockReset();
  vi.mocked(fullReplaceListings).mockReset();
  vi.mocked(embedAllListings).mockReset();
  vi.mocked(rebuildListingGraph).mockReset();
  vi.mocked(coworkerAdapter.discover).mockReset();
  vi.mocked(coworkerAdapter.fetchDetail).mockReset();
  vi.mocked(myhqAdapter.discover).mockReset();
  vi.mocked(myhqAdapter.fetchDetail).mockReset();
  vi.mocked(cofyndAdapter.discover).mockReset();
  vi.mocked(cofyndAdapter.fetchDetail).mockReset();
  vi.mocked(gofloatersAdapter.discover).mockReset();
  vi.mocked(gofloatersAdapter.fetchDetail).mockReset();

  vi.mocked(startSyncRun).mockResolvedValue(undefined);
  vi.mocked(finishSyncRun).mockResolvedValue(undefined);
  vi.mocked(fullReplaceListings).mockResolvedValue(undefined);
  vi.mocked(embedAllListings).mockResolvedValue(0);
  vi.mocked(rebuildListingGraph).mockResolvedValue({ listings: 0, skipped: true });
});

describe("runListingsSync", () => {
  it("aborts when no source returns listings", async () => {
    vi.mocked(coworkerAdapter.discover).mockResolvedValue([]);
    vi.mocked(myhqAdapter.discover).mockResolvedValue([]);
    vi.mocked(cofyndAdapter.discover).mockResolvedValue([]);
    vi.mocked(gofloatersAdapter.discover).mockResolvedValue([]);

    const run = await runListingsSync();

    expect(run.status).toBe("failed");
    expect(run.error).toBe("abort: sourcesOk=0 count=0");
    expect(startSyncRun).toHaveBeenCalledOnce();
    expect(finishSyncRun).toHaveBeenCalledWith(
      expect.any(String),
      "failed",
      null,
      "abort: sourcesOk=0 count=0",
    );
    expect(fullReplaceListings).not.toHaveBeenCalled();
  });

  it("aborts when total raw count is below 10", async () => {
    const coworkerDiscovered = makeDiscovered(5);
    vi.mocked(coworkerAdapter.discover).mockResolvedValue(coworkerDiscovered);
    mockDetailFetch(coworkerAdapter.fetchDetail, "coworker", coworkerDiscovered);
    vi.mocked(myhqAdapter.discover).mockResolvedValue([]);
    vi.mocked(cofyndAdapter.discover).mockResolvedValue([]);
    vi.mocked(gofloatersAdapter.discover).mockResolvedValue([]);

    const run = await runListingsSync();

    expect(run.status).toBe("failed");
    expect(finishSyncRun).toHaveBeenCalledWith(
      expect.any(String),
      "failed",
      null,
      "abort: sourcesOk=1 count=5",
    );
    expect(fullReplaceListings).not.toHaveBeenCalled();
  });

  it("replaces listings when at least one source succeeds with 10+ rows", async () => {
    const coworkerDiscovered = makeDiscovered(10);
    vi.mocked(coworkerAdapter.discover).mockResolvedValue(coworkerDiscovered);
    mockDetailFetch(coworkerAdapter.fetchDetail, "coworker", coworkerDiscovered);
    vi.mocked(myhqAdapter.discover).mockResolvedValue([]);
    vi.mocked(cofyndAdapter.discover).mockResolvedValue([]);
    vi.mocked(gofloatersAdapter.discover).mockResolvedValue([]);

    const run = await runListingsSync();

    expect(run.status).toBe("success");
    expect(run.count).toBe(10);
    expect(fullReplaceListings).toHaveBeenCalledOnce();
    const inserted = vi.mocked(fullReplaceListings).mock.calls[0][0];
    expect(inserted).toHaveLength(10);
    expect(inserted[0]).toMatchObject({
      source: "coworker",
      slug: expect.stringMatching(/^coworker-space-\d+-coworker-\d+$/),
      syncedAt: expect.any(String),
    });
    expect(finishSyncRun).toHaveBeenCalledWith(
      expect.any(String),
      "success",
      10,
      null,
    );
  });

  it("keeps rebuilding the graph even if embedding fails", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";

    const coworkerDiscovered = makeDiscovered(10);
    vi.mocked(coworkerAdapter.discover).mockResolvedValue(coworkerDiscovered);
    mockDetailFetch(coworkerAdapter.fetchDetail, "coworker", coworkerDiscovered);
    vi.mocked(myhqAdapter.discover).mockResolvedValue([]);
    vi.mocked(cofyndAdapter.discover).mockResolvedValue([]);
    vi.mocked(gofloatersAdapter.discover).mockResolvedValue([]);
    vi.mocked(embedAllListings).mockRejectedValueOnce(new Error("embed failed"));

    const run = await runListingsSync();

    expect(run.status).toBe("success");
    expect(embedAllListings).toHaveBeenCalledOnce();
    expect(rebuildListingGraph).toHaveBeenCalledOnce();
  });

  it("ignores rejected adapters and still succeeds on combined rows", async () => {
    vi.mocked(coworkerAdapter.discover).mockRejectedValue(new Error("network"));
    const myhqDiscovered = makeDiscovered(6, "myhq");
    vi.mocked(myhqAdapter.discover).mockResolvedValue(myhqDiscovered);
    mockDetailFetch(myhqAdapter.fetchDetail, "myhq", myhqDiscovered);
    const cofyndDiscovered = makeDiscovered(5, "cofynd");
    vi.mocked(cofyndAdapter.discover).mockResolvedValue(cofyndDiscovered);
    mockDetailFetch(cofyndAdapter.fetchDetail, "cofynd", cofyndDiscovered);
    vi.mocked(gofloatersAdapter.discover).mockResolvedValue([]);

    const run = await runListingsSync();

    expect(run.status).toBe("success");
    expect(run.count).toBe(11);
    expect(fullReplaceListings).toHaveBeenCalledOnce();
    expect(finishSyncRun).toHaveBeenCalledWith(
      expect.any(String),
      "success",
      11,
      null,
    );
  });
});
