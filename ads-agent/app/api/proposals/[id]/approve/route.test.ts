import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "@/lib/types";

const { getProposalById, decideProposal, executeProposal, requireApiRole } = vi.hoisted(() => ({
  getProposalById: vi.fn(),
  decideProposal: vi.fn(),
  executeProposal: vi.fn(),
  requireApiRole: vi.fn(),
}));

vi.mock("@/lib/db/proposals", () => ({ getProposalById, decideProposal }));
vi.mock("@/lib/executor/execute", () => ({ executeProposal }));
vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));

import { POST } from "./route";

function pendingProposal(): Proposal {
  return {
    id: "prop-1",
    kind: "pause",
    campaignId: "camp-1",
    payload: {},
    triggeredRule: "kill_rule",
    rationale: null,
    status: "pending",
    error: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    decidedAt: null,
    executedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireApiRole.mockResolvedValue({
    ok: true,
    session: { userId: "u-1", email: "a@b.com", orgId: "org-1", role: "operator" },
  });
});

describe("POST /api/proposals/[id]/approve", () => {
  it("returns 404 when the proposal does not exist", async () => {
    getProposalById.mockResolvedValue(null);
    const res = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the proposal is not pending", async () => {
    getProposalById.mockResolvedValue({ ...pendingProposal(), status: "executed" });
    const res = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "prop-1" }) });
    expect(res.status).toBe(409);
    expect(decideProposal).not.toHaveBeenCalled();
  });

  it("decides approved then executes and returns the result", async () => {
    getProposalById.mockResolvedValue(pendingProposal());
    executeProposal.mockResolvedValue({ status: "executed" });

    const res = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "prop-1" }) });

    expect(decideProposal).toHaveBeenCalledWith("prop-1", "approved", "u-1", "ui");
    expect(executeProposal).toHaveBeenCalledWith("prop-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: { status: "executed" } });
  });
});
