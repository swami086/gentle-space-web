import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
}));

import type { Scope } from "./scope-sql";
import {
  createProposal,
  decideProposal,
  getProposalById,
  listProposals,
  markProposalExecuted,
  markProposalFailed,
  updateProposalPayload,
} from "./proposals";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const PLATFORM: Scope = { kind: "platform", orgId: "00000000-0000-0000-0000-000000000001" };

const row = {
  id: "prop-1",
  kind: "pause",
  campaign_id: "camp-1",
  payload: { campaignId: "camp-1" },
  triggered_rule: "kill_rule",
  rationale: "CPL has been 40% over breakeven for 3 days.",
  status: "pending",
  error: null,
  created_at: new Date("2026-08-03T00:00:00.000Z"),
  decided_at: null,
  executed_at: null,
};

beforeEach(() => query.mockReset());

describe("createProposal", () => {
  it("stamps the caller's org_id and returns the mapped proposal", async () => {
    query.mockResolvedValue({ rows: [row] });
    const result = await createProposal(ORG, {
      kind: "pause",
      campaignId: "camp-1",
      payload: { campaignId: "camp-1" },
      triggeredRule: "kill_rule",
      rationale: "CPL has been 40% over breakeven for 3 days.",
    });
    expect(result.id).toBe("prop-1");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.proposals");
    expect(sql).toContain("org_id");
    expect(params[0]).toBe(ORG.orgId);
  });
});

describe("listProposals", () => {
  it("scopes every listing to the caller", async () => {
    query.mockResolvedValue({ rows: [row] });
    await listProposals(ORG);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("WHERE org_id = $1::uuid");
    expect(params).toEqual([ORG.orgId]);
  });

  it("adds the status filter as $2, after the scope param", async () => {
    query.mockResolvedValue({ rows: [row] });
    await listProposals(ORG, "pending");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("status = $2");
    expect(params).toEqual([ORG.orgId, "pending"]);
  });

  it("does not constrain org_id under platform scope", async () => {
    query.mockResolvedValue({ rows: [row] });
    await listProposals(PLATFORM);
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toContain("org_id = $1");
    expect(params).toEqual([PLATFORM.orgId]);
  });
});

describe("getProposalById", () => {
  it("returns null when the row is outside the caller's scope", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getProposalById(ORG, "someone-elses-id")).resolves.toBeNull();
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "someone-elses-id"]);
  });
});

describe("decideProposal", () => {
  it("scopes the update and records the decider", async () => {
    query.mockResolvedValue({ rows: [] });
    await decideProposal(ORG, "prop-1", "approved", "user-1", "ui");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("org_id = $1::uuid");
    expect(sql).toContain("decided_by = $4");
    expect(params).toEqual([ORG.orgId, "prop-1", "approved", "user-1", "ui"]);
  });

  it("defaults the decision route to ui", async () => {
    query.mockResolvedValue({ rows: [] });
    await decideProposal(ORG, "prop-1", "rejected", "user-1");
    expect(query.mock.calls[0][1][4]).toBe("ui");
  });
});

describe("markProposalExecuted", () => {
  it("scopes the update", async () => {
    query.mockResolvedValue({ rows: [] });
    await markProposalExecuted(ORG, "prop-1");
    expect(query.mock.calls[0][0]).toContain("org_id = $1::uuid");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "prop-1"]);
  });
});

describe("markProposalFailed", () => {
  it("scopes the update and stores the error", async () => {
    query.mockResolvedValue({ rows: [] });
    await markProposalFailed(ORG, "prop-1", "insufficient budget");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "prop-1", "insufficient budget"]);
  });
});

describe("updateProposalPayload", () => {
  it("scopes the update and throws when nothing matched", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(updateProposalPayload(ORG, "prop-1", { dailyBudgetInr: 700 })).rejects.toThrow(
      "proposal prop-1 not found",
    );
  });

  it("returns the mapped proposal on success", async () => {
    query.mockResolvedValue({ rows: [{ ...row, payload: { dailyBudgetInr: 700 } }] });
    const result = await updateProposalPayload(ORG, "prop-1", { dailyBudgetInr: 700 });
    expect(result.payload).toEqual({ dailyBudgetInr: 700 });
  });
});
