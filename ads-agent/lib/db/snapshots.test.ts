import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
}));

import type { Scope } from "./scope-sql";
import {
  latestCrmSignalSnapshot,
  recentPerformanceSnapshots,
  recordCrmSignalSnapshot,
  recordPerformanceSnapshot,
} from "./snapshots";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

beforeEach(() => query.mockReset());

describe("recordPerformanceSnapshot", () => {
  it("derives org_id from the parent campaign inside the caller's scope", async () => {
    query.mockResolvedValue({ rows: [{ id: "snap-1" }] });
    await recordPerformanceSnapshot(ORG, {
      campaignId: "camp-1",
      spend: 1000,
      clicks: 50,
      impressions: 900,
      conversions: 4,
      raw: {},
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.performance_snapshots");
    expect(sql).toContain("FROM adsagent.campaigns c");
    expect(sql).toContain("org_id = $1::uuid");
    expect(params[0]).toBe(ORG.orgId);
    expect(params[1]).toBe("camp-1");
    // cpl = spend / conversions
    expect(params[6]).toBe(250);
  });

  it("stores a null cpl when there were no conversions", async () => {
    query.mockResolvedValue({ rows: [{ id: "snap-1" }] });
    await recordPerformanceSnapshot(ORG, {
      campaignId: "camp-1",
      spend: 1000,
      clicks: 50,
      impressions: 900,
      conversions: 0,
    });
    expect(query.mock.calls[0][1][6]).toBeNull();
  });

  it("throws when the campaign is outside the caller's scope", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(
      recordPerformanceSnapshot(ORG, {
        campaignId: "camp-x",
        spend: 1,
        clicks: 1,
        impressions: 1,
        conversions: 1,
      }),
    ).rejects.toThrow("campaign camp-x not found");
  });
});

describe("recentPerformanceSnapshots", () => {
  it("parameterises the day window instead of interpolating it", async () => {
    query.mockResolvedValue({ rows: [] });
    await recentPerformanceSnapshots(ORG, 7);
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toContain("INTERVAL '7");
    expect(sql).toContain("($2 || ' days')::interval");
    expect(params).toEqual([ORG.orgId, 7]);
  });
});

describe("recordCrmSignalSnapshot", () => {
  it("stamps the caller's org_id directly, since campaign_id is nullable", async () => {
    query.mockResolvedValue({ rows: [] });
    await recordCrmSignalSnapshot(ORG, {
      campaignId: null,
      hotCount: 1,
      warmCount: 2,
      coldCount: 3,
      unscoredCount: 4,
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.crm_signal_snapshots");
    expect(params).toEqual([ORG.orgId, null, 1, 2, 3, 4]);
  });
});

describe("latestCrmSignalSnapshot", () => {
  it("scopes the read", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(latestCrmSignalSnapshot(ORG)).resolves.toBeNull();
    expect(query.mock.calls[0][0]).toContain("org_id = $1::uuid");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId]);
  });
});
