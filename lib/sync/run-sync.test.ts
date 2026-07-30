import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawListing } from "./sources/types";

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
  coworkerAdapter: { source: "coworker", fetchAll: vi.fn() },
  myhqAdapter: { source: "myhq", fetchAll: vi.fn() },
  cofyndAdapter: { source: "cofynd", fetchAll: vi.fn() },
  gofloatersAdapter: { source: "gofloaters", fetchAll: vi.fn() },
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

beforeEach(() => {
  delete process.env.AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

  vi.mocked(startSyncRun).mockReset();
  vi.mocked(finishSyncRun).mockReset();
  vi.mocked(fullReplaceListings).mockReset();
  vi.mocked(embedAllListings).mockReset();
  vi.mocked(rebuildListingGraph).mockReset();
  vi.mocked(coworkerAdapter.fetchAll).mockReset();
  vi.mocked(myhqAdapter.fetchAll).mockReset();
  vi.mocked(cofyndAdapter.fetchAll).mockReset();
  vi.mocked(gofloatersAdapter.fetchAll).mockReset();

  vi.mocked(startSyncRun).mockResolvedValue(undefined);
  vi.mocked(finishSyncRun).mockResolvedValue(undefined);
  vi.mocked(fullReplaceListings).mockResolvedValue(undefined);
  vi.mocked(embedAllListings).mockResolvedValue(0);
  vi.mocked(rebuildListingGraph).mockResolvedValue({ listings: 0, skipped: true });
});

describe("runListingsSync", () => {
  it("aborts when no source returns listings", async () => {
    vi.mocked(coworkerAdapter.fetchAll).mockResolvedValue([]);
    vi.mocked(myhqAdapter.fetchAll).mockResolvedValue([]);
    vi.mocked(cofyndAdapter.fetchAll).mockResolvedValue([]);
    vi.mocked(gofloatersAdapter.fetchAll).mockResolvedValue([]);

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
    vi.mocked(coworkerAdapter.fetchAll).mockResolvedValue(makeListings(5));
    vi.mocked(myhqAdapter.fetchAll).mockResolvedValue([]);
    vi.mocked(cofyndAdapter.fetchAll).mockResolvedValue([]);
    vi.mocked(gofloatersAdapter.fetchAll).mockResolvedValue([]);

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
    vi.mocked(coworkerAdapter.fetchAll).mockResolvedValue(makeListings(10));
    vi.mocked(myhqAdapter.fetchAll).mockResolvedValue([]);
    vi.mocked(cofyndAdapter.fetchAll).mockResolvedValue([]);
    vi.mocked(gofloatersAdapter.fetchAll).mockResolvedValue([]);

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

    vi.mocked(coworkerAdapter.fetchAll).mockResolvedValue(makeListings(10));
    vi.mocked(myhqAdapter.fetchAll).mockResolvedValue([]);
    vi.mocked(cofyndAdapter.fetchAll).mockResolvedValue([]);
    vi.mocked(gofloatersAdapter.fetchAll).mockResolvedValue([]);
    vi.mocked(embedAllListings).mockRejectedValueOnce(new Error("embed failed"));

    const run = await runListingsSync();

    expect(run.status).toBe("success");
    expect(embedAllListings).toHaveBeenCalledOnce();
    expect(rebuildListingGraph).toHaveBeenCalledOnce();
  });

  it("ignores rejected adapters and still succeeds on combined rows", async () => {
    vi.mocked(coworkerAdapter.fetchAll).mockRejectedValue(new Error("network"));
    vi.mocked(myhqAdapter.fetchAll).mockResolvedValue(makeListings(6, "myhq"));
    vi.mocked(cofyndAdapter.fetchAll).mockResolvedValue(makeListings(5, "cofynd"));
    vi.mocked(gofloatersAdapter.fetchAll).mockResolvedValue([]);

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
