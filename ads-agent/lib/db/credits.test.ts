import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import {
  listOrgBalances,
  listMemberBalances,
  getSpendByFeature,
  getSpendByModel,
  getSpendTrend,
} from "./credits";

beforeEach(() => query.mockReset());

describe("listOrgBalances", () => {
  it("returns empty array when there are no orgs", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(listOrgBalances()).resolves.toEqual([]);
  });

  it("maps org rows with numeric balances", async () => {
    query.mockResolvedValue({
      rows: [{ org_id: "org-1", org_name: "Acme", balance_credits: "1000" }],
    });
    await expect(listOrgBalances()).resolves.toEqual([
      { orgId: "org-1", orgName: "Acme", balanceCredits: 1000 },
    ]);
  });
});

describe("listMemberBalances", () => {
  it("returns null capCredits for members with no individual cap row", async () => {
    query.mockResolvedValue({
      rows: [
        { user_id: "u-1", email: "a@x.com", display_name: null, cap_credits: null },
      ],
    });
    const result = await listMemberBalances("org-1");
    expect(result).toEqual([{ userId: "u-1", email: "a@x.com", displayName: null, capCredits: null }]);
    expect(query).toHaveBeenCalledWith(expect.any(String), ["org-1"]);
  });
});

describe("getSpendByFeature / getSpendByModel", () => {
  it("aggregates credits and cost per feature", async () => {
    query.mockResolvedValue({
      rows: [{ key: "ads-agent:campaign-chat", total_credits: "12.5", total_cost_usd: "0.125" }],
    });
    await expect(getSpendByFeature("org-1", 30)).resolves.toEqual([
      { key: "ads-agent:campaign-chat", totalCredits: 12.5, totalCostUsd: 0.125 },
    ]);
  });

  it("aggregates credits and cost per model", async () => {
    query.mockResolvedValue({
      rows: [{ key: "gemini-2.5-flash-lite", total_credits: "5", total_cost_usd: "0.05" }],
    });
    await expect(getSpendByModel("org-1", 30)).resolves.toEqual([
      { key: "gemini-2.5-flash-lite", totalCredits: 5, totalCostUsd: 0.05 },
    ]);
  });
});

describe("getSpendTrend", () => {
  it("returns empty array when there is no usage yet", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getSpendTrend("org-1", 30)).resolves.toEqual([]);
  });

  it("maps day buckets to ISO date strings", async () => {
    query.mockResolvedValue({
      rows: [{ day: new Date("2026-08-04T00:00:00.000Z"), total_credits: "3.2" }],
    });
    await expect(getSpendTrend("org-1", 30)).resolves.toEqual([
      { date: "2026-08-04", totalCredits: 3.2 },
    ]);
  });
});
