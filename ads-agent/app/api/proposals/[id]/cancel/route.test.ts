import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import type { Proposal } from "@/lib/types";

const TEST_SCOPE = { kind: "org" as const, orgId: "org-1" };

const { getProposalById, cancelScheduledProposal, guard } = vi.hoisted(() => ({
  getProposalById: vi.fn(),
  cancelScheduledProposal: vi.fn(),
  guard: vi.fn(),
}));

vi.mock("@/lib/db/proposals", () => ({ getProposalById, cancelScheduledProposal }));
vi.mock("@/lib/auth/guard", async () => {
  const { NextResponse } = await import("next/server");
  return {
    guard,
    ownedOr404: async (loader: (s: typeof TEST_SCOPE) => Promise<unknown>, scope: typeof TEST_SCOPE) => {
      const entity = await loader(scope);
      if (!entity) return { ok: false, response: NextResponse.json({ error: "not found" }, { status: 404 }) };
      return { ok: true, entity };
    },
  };
});

import { POST } from "./route";

function scheduledProposal(): Proposal {
  return {
    id: "prop-1",
    kind: "pause",
    campaignId: "camp-1",
    payload: {},
    triggeredRule: "kill_rule",
    rationale: null,
    status: "scheduled",
    error: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    decidedAt: "2026-08-12T00:00:00.000Z",
    executedAt: null,
    scheduledFor: "2026-08-12T00:00:00.000Z",
    undoUntil: "2026-08-12T00:05:00.000Z",
    batchId: "batch-1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({
    ok: true,
    session: { userId: "u-1", email: "a@b.com", orgId: "org-1", role: "operator" },
    scope: TEST_SCOPE,
  });
});

describe("POST /api/proposals/[id]/cancel", () => {
  it("returns 404 when the proposal does not exist", async () => {
    getProposalById.mockResolvedValue(null);
    const res = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
    expect(cancelScheduledProposal).not.toHaveBeenCalled();
  });

  it("returns 409 when the proposal is not scheduled", async () => {
    getProposalById.mockResolvedValue({ ...scheduledProposal(), status: "pending" });
    const res = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "prop-1" }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "proposal is pending, not scheduled" });
    expect(cancelScheduledProposal).not.toHaveBeenCalled();
  });

  it("returns 409 when the undo window has elapsed", async () => {
    getProposalById.mockResolvedValue(scheduledProposal());
    cancelScheduledProposal.mockResolvedValue(null);
    const res = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "prop-1" }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "undo window elapsed" });
    expect(cancelScheduledProposal).toHaveBeenCalledWith(TEST_SCOPE, "prop-1");
  });

  it("cancels a scheduled proposal and returns it as pending", async () => {
    getProposalById.mockResolvedValue(scheduledProposal());
    const reverted = { ...scheduledProposal(), status: "pending" as const, undoUntil: null, batchId: null };
    cancelScheduledProposal.mockResolvedValue(reverted);

    const res = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "prop-1" }) });

    expect(cancelScheduledProposal).toHaveBeenCalledWith(TEST_SCOPE, "prop-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, proposal: reverted });
  });
});
