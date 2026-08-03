import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import { getOverviewStats, getSpendCplTrend, listCampaignsWithLatestCpl } from "./dashboard";

beforeEach(() => query.mockReset());

describe("getOverviewStats", () => {
  it("computes blended CPL from total spend and conversions", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: "3" }] })
      .mockResolvedValueOnce({ rows: [{ count: "5" }] })
      .mockResolvedValueOnce({ rows: [{ spend: "10000", conversions: "4" }] });

    const result = await getOverviewStats();

    expect(result).toEqual({
      activeCampaignCount: 3,
      pendingProposalCount: 5,
      monthSpendInr: 10000,
      blendedCplInr: 2500,
    });
  });

  it("returns a null blended CPL when there are zero conversions this month", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: "0" }] })
      .mockResolvedValueOnce({ rows: [{ count: "0" }] })
      .mockResolvedValueOnce({ rows: [{ spend: "0", conversions: "0" }] });

    const result = await getOverviewStats();

    expect(result.blendedCplInr).toBeNull();
    expect(result.monthSpendInr).toBe(0);
  });
});

describe("getSpendCplTrend", () => {
  it("maps each day's totals and computes per-day CPL", async () => {
    query.mockResolvedValue({
      rows: [
        { day: new Date("2026-08-01T00:00:00.000Z"), spend: "5000", conversions: "2" },
        { day: new Date("2026-08-02T00:00:00.000Z"), spend: "3000", conversions: "0" },
      ],
    });

    const result = await getSpendCplTrend(30);

    expect(result).toEqual([
      { date: "2026-08-01", spendInr: 5000, cplInr: 2500 },
      { date: "2026-08-02", spendInr: 3000, cplInr: null },
    ]);
  });

  it("returns an empty array when there are no snapshots", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getSpendCplTrend(30)).resolves.toEqual([]);
  });
});

describe("listCampaignsWithLatestCpl", () => {
  it("maps each campaign with its most recent CPL", async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: "camp-1",
          name: "Whitefield Office Search",
          platform: "google",
          status: "active",
          daily_budget: "500",
          corridor: "whitefield",
          latest_cpl: "1800",
        },
      ],
    });

    const result = await listCampaignsWithLatestCpl();

    expect(result).toEqual([
      {
        id: "camp-1",
        name: "Whitefield Office Search",
        platform: "google",
        status: "active",
        dailyBudget: 500,
        corridor: "whitefield",
        latestCplInr: 1800,
      },
    ]);
  });

  it("returns null latestCplInr for a campaign with no snapshots yet", async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: "camp-2",
          name: "New Campaign",
          platform: "meta",
          status: "proposed",
          daily_budget: null,
          corridor: null,
          latest_cpl: null,
        },
      ],
    });

    const result = await listCampaignsWithLatestCpl();
    expect(result[0].latestCplInr).toBeNull();
  });
});
