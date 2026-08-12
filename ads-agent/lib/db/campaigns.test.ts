import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
}));

import type { Scope } from "./scope-sql";
import {
  createCampaignRecord,
  getCampaignById,
  listCampaigns,
  markCampaignActive,
  updateCampaignBudget,
  updateCampaignStatus,
} from "./campaigns";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

const row = {
  id: "camp-1",
  platform: "google",
  external_id: null,
  name: "HSR search",
  status: "proposed",
  daily_budget: "700",
  corridor: "HSR",
  created_at: new Date("2026-08-03T00:00:00.000Z"),
};

beforeEach(() => query.mockReset());

describe("createCampaignRecord", () => {
  it("stamps org_id and numbers the rest from $2", async () => {
    query.mockResolvedValue({ rows: [row] });
    await createCampaignRecord(ORG, {
      platform: "google",
      name: "HSR search",
      dailyBudget: 700,
      corridor: "HSR",
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.campaigns");
    expect(sql).toContain("(org_id, platform, name, daily_budget, corridor)");
    expect(params).toEqual([ORG.orgId, "google", "HSR search", 700, "HSR"]);
  });
});

describe("listCampaigns", () => {
  it("scopes the listing", async () => {
    query.mockResolvedValue({ rows: [row] });
    await listCampaigns(ORG);
    expect(query.mock.calls[0][0]).toContain("WHERE org_id = $1::uuid");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId]);
  });
});

describe("getCampaignById", () => {
  it("returns null outside the caller's scope", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getCampaignById(ORG, "camp-x")).resolves.toBeNull();
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "camp-x"]);
  });
});

describe("markCampaignActive", () => {
  it("scopes the update", async () => {
    query.mockResolvedValue({ rows: [] });
    await markCampaignActive(ORG, "camp-1", "ext-1");
    expect(query.mock.calls[0][0]).toContain("org_id = $1::uuid");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "camp-1", "ext-1"]);
  });
});

describe("updateCampaignBudget", () => {
  it("scopes the update", async () => {
    query.mockResolvedValue({ rows: [] });
    await updateCampaignBudget(ORG, "camp-1", 900);
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "camp-1", 900]);
  });
});

describe("updateCampaignStatus", () => {
  it("scopes the update", async () => {
    query.mockResolvedValue({ rows: [] });
    await updateCampaignStatus(ORG, "camp-1", "paused");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "camp-1", "paused"]);
  });
});
