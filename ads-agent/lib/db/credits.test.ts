import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
}));

import type { Scope } from "./scope-sql";
import {
  getSpendByFeature,
  getSpendByModel,
  getSpendTrend,
  listMemberBalances,
  listOrgBalances,
} from "./credits";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const PLATFORM: Scope = { kind: "platform", orgId: "00000000-0000-0000-0000-000000000001" };

beforeEach(() => query.mockReset());

describe("listOrgBalances", () => {
  it("throws when handed an org scope — it lists every org on the platform", async () => {
    await expect(listOrgBalances(ORG)).rejects.toThrow(
      "listOrgBalances requires platform scope",
    );
    expect(query, "must not reach the database at all").not.toHaveBeenCalled();
  });

  it("returns every org's balance under platform scope", async () => {
    query.mockResolvedValue({
      rows: [{ org_id: "o1", org_name: "One", balance_credits: "100" }],
    });
    await expect(listOrgBalances(PLATFORM)).resolves.toEqual([
      { orgId: "o1", orgName: "One", balanceCredits: 100 },
    ]);
  });
});

describe("listMemberBalances", () => {
  it("lists only the caller's members", async () => {
    query.mockResolvedValue({ rows: [] });
    await listMemberBalances(ORG);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("public.users");
    expect(sql).toContain("u.org_id = $1::uuid");
    expect(params).toEqual([ORG.orgId]);
  });
});

describe("getSpendByFeature", () => {
  it("scopes the ledger and passes days as $2", async () => {
    query.mockResolvedValue({ rows: [] });
    await getSpendByFeature(ORG, 30);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("adsagent.usage_ledger");
    expect(sql).toContain("feature AS key");
    expect(params).toEqual([ORG.orgId, 30]);
  });
});

describe("getSpendByModel", () => {
  it("groups by model", async () => {
    query.mockResolvedValue({ rows: [] });
    await getSpendByModel(ORG, 7);
    expect(query.mock.calls[0][0]).toContain("model AS key");
  });
});

describe("getSpendTrend", () => {
  it("scopes the trend", async () => {
    query.mockResolvedValue({ rows: [] });
    await getSpendTrend(ORG, 14);
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, 14]);
  });
});
