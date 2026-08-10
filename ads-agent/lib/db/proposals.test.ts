import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import {
  createProposal,
  decideProposal,
  getProposalById,
  listProposals,
  markProposalExecuted,
  markProposalFailed,
  updateProposalPayload,
} from "./proposals";

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
  it("inserts payload as jsonb and returns the mapped proposal", async () => {
    query.mockResolvedValue({ rows: [row] });
    const result = await createProposal({
      kind: "pause",
      campaignId: "camp-1",
      payload: { campaignId: "camp-1" },
      triggeredRule: "kill_rule",
      rationale: "CPL has been 40% over breakeven for 3 days.",
    });
    expect(result.id).toBe("prop-1");
    expect(result.payload).toEqual({ campaignId: "camp-1" });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO proposals"),
      [
        "pause",
        "camp-1",
        JSON.stringify({ campaignId: "camp-1" }),
        "kill_rule",
        "CPL has been 40% over breakeven for 3 days.",
      ],
    );
  });

  it("defaults rationale to null when omitted", async () => {
    query.mockResolvedValue({ rows: [{ ...row, rationale: null }] });
    await createProposal({
      kind: "pause",
      campaignId: "camp-1",
      payload: {},
      triggeredRule: "kill_rule",
    });
    expect(query.mock.calls[0][1][4]).toBeNull();
  });

  it("accepts the campaign_strategy kind", async () => {
    query.mockResolvedValue({ rows: [{ ...row, kind: "campaign_strategy" }] });
    await createProposal({
      kind: "campaign_strategy",
      campaignId: null,
      payload: { summary: "Shift budget toward Whitefield", recommendations: [] },
      triggeredRule: "hermes:campaign_strategy",
    });
    expect(query.mock.calls[0][1][0]).toBe("campaign_strategy");
  });
});

describe("listProposals", () => {
  it("lists all proposals when no status given", async () => {
    query.mockResolvedValue({ rows: [row] });
    await listProposals();
    expect(query).toHaveBeenCalledWith(expect.not.stringContaining("WHERE"), []);
  });

  it("filters by status when given", async () => {
    query.mockResolvedValue({ rows: [row] });
    await listProposals("pending");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE status = $1"), [
      "pending",
    ]);
  });
});

describe("getProposalById", () => {
  it("returns null when missing", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getProposalById("missing")).resolves.toBeNull();
  });
});

describe("decideProposal", () => {
  it("sets status and decided_at", async () => {
    query.mockResolvedValue({ rows: [] });
    await decideProposal("prop-1", "approved");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("decided_at = NOW()"), [
      "prop-1",
      "approved",
    ]);
  });
});

describe("markProposalExecuted", () => {
  it("sets status executed and executed_at", async () => {
    query.mockResolvedValue({ rows: [] });
    await markProposalExecuted("prop-1");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("executed_at = NOW()"), [
      "prop-1",
    ]);
  });
});

describe("markProposalFailed", () => {
  it("sets status failed with error message", async () => {
    query.mockResolvedValue({ rows: [] });
    await markProposalFailed("prop-1", "insufficient budget");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'failed'"), [
      "prop-1",
      "insufficient budget",
    ]);
  });
});

describe("updateProposalPayload", () => {
  it("overwrites the payload column and returns the mapped proposal", async () => {
    query.mockResolvedValue({ rows: [{ ...row, payload: { dailyBudgetInr: 700 } }] });
    const result = await updateProposalPayload("prop-1", { dailyBudgetInr: 700 });
    expect(result.payload).toEqual({ dailyBudgetInr: 700 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE proposals SET payload = $2::jsonb"),
      ["prop-1", JSON.stringify({ dailyBudgetInr: 700 })],
    );
  });
});
