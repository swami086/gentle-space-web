import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import {
  latestCrmSignalSnapshot,
  recentPerformanceSnapshots,
  recordCrmSignalSnapshot,
  recordPerformanceSnapshot,
} from "./snapshots";

beforeEach(() => query.mockReset());

describe("recordPerformanceSnapshot", () => {
  it("computes cpl from spend/conversions and inserts raw as jsonb", async () => {
    query.mockResolvedValue({ rows: [] });
    await recordPerformanceSnapshot({
      campaignId: "camp-1",
      spend: 4000,
      clicks: 120,
      impressions: 5000,
      conversions: 2,
      raw: { source: "google" },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO performance_snapshots"), [
      "camp-1",
      4000,
      120,
      5000,
      2,
      2000,
      JSON.stringify({ source: "google" }),
    ]);
  });

  it("stores a null cpl when there are zero conversions", async () => {
    query.mockResolvedValue({ rows: [] });
    await recordPerformanceSnapshot({
      campaignId: "camp-1",
      spend: 500,
      clicks: 10,
      impressions: 200,
      conversions: 0,
    });
    expect(query.mock.calls[0][1][5]).toBeNull();
  });
});

describe("recentPerformanceSnapshots", () => {
  it("queries with the given day window", async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: "snap-1",
          campaign_id: "camp-1",
          captured_at: new Date("2026-08-03T00:00:00.000Z"),
          spend: "1000",
          clicks: 20,
          impressions: 400,
          conversions: 1,
          cpl: "1000",
        },
      ],
    });
    const result = await recentPerformanceSnapshots(3);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INTERVAL '3 days'"), []);
    expect(result[0]).toMatchObject({ id: "snap-1", spend: 1000, cpl: 1000 });
  });
});

describe("recordCrmSignalSnapshot", () => {
  it("inserts counts with nullable campaignId", async () => {
    query.mockResolvedValue({ rows: [] });
    await recordCrmSignalSnapshot({
      campaignId: null,
      hotCount: 3,
      warmCount: 5,
      coldCount: 2,
      unscoredCount: 1,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO crm_signal_snapshots"), [
      null,
      3,
      5,
      2,
      1,
    ]);
  });
});

describe("latestCrmSignalSnapshot", () => {
  it("returns null when no snapshot exists", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(latestCrmSignalSnapshot()).resolves.toBeNull();
  });

  it("maps the most recent row", async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: "sig-1",
          campaign_id: null,
          captured_at: new Date("2026-08-03T00:00:00.000Z"),
          hot_count: 4,
          warm_count: 6,
          cold_count: 3,
          unscored_count: 0,
        },
      ],
    });
    await expect(latestCrmSignalSnapshot()).resolves.toMatchObject({
      id: "sig-1",
      hotCount: 4,
      warmCount: 6,
    });
  });
});
