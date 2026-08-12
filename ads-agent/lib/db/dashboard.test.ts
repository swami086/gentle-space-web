import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
}));

import type { Scope } from "./scope-sql";
import { getOverviewStats, getSpendCplTrend, listCampaignsWithLatestCpl } from "./dashboard";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

beforeEach(() => query.mockReset());

describe("getOverviewStats", () => {
  it("scopes all three aggregates and computes blended CPL", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: "3" }] })
      .mockResolvedValueOnce({ rows: [{ count: "2" }] })
      .mockResolvedValueOnce({ rows: [{ spend: "4000", conversions: "8" }] });

    await expect(getOverviewStats(ORG)).resolves.toEqual({
      activeCampaignCount: 3,
      pendingProposalCount: 2,
      monthSpendInr: 4000,
      blendedCplInr: 500,
    });
    for (const call of query.mock.calls) {
      expect(call[0]).toContain("org_id = $1::uuid");
      expect(call[1]).toEqual([ORG.orgId]);
    }
  });

  it("reports a null blended CPL when there were no conversions", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: "0" }] })
      .mockResolvedValueOnce({ rows: [{ count: "0" }] })
      .mockResolvedValueOnce({ rows: [{ spend: "0", conversions: "0" }] });
    const stats = await getOverviewStats(ORG);
    expect(stats.blendedCplInr).toBeNull();
  });
});

describe("getSpendCplTrend", () => {
  it("parameterises the day window instead of interpolating it", async () => {
    query.mockResolvedValue({ rows: [] });
    await getSpendCplTrend(ORG, 30);
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toContain("INTERVAL '30");
    expect(sql).toContain("($2 || ' days')::interval");
    expect(params).toEqual([ORG.orgId, 30]);
  });
});

describe("listCampaignsWithLatestCpl", () => {
  it("scopes the outer query and the lateral join", async () => {
    query.mockResolvedValue({ rows: [] });
    await listCampaignsWithLatestCpl(ORG);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("c.org_id = $1::uuid");
    expect(sql).toContain("p.org_id = c.org_id");
    expect(params).toEqual([ORG.orgId]);
  });
});
