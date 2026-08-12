import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "@/lib/types";

const TEST_SCOPE = { kind: "org" as const, orgId: "org-1" };

const { getProposalById, decideProposal, guard } = vi.hoisted(() => ({
  getProposalById: vi.fn(),
  decideProposal: vi.fn(),
  guard: vi.fn(),
}));

vi.mock("@/lib/db/proposals", () => ({ getProposalById, decideProposal }));
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
  guard.mockResolvedValue({
    ok: true,
    session: { userId: "u-1", email: "a@b.com", orgId: "org-1", role: "operator" },
    scope: TEST_SCOPE,
  });
});

describe("POST /api/proposals/[id]/reject", () => {
  it("returns 404 when the proposal does not exist", async () => {
    getProposalById.mockResolvedValue(null);
    const res = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("decides rejected and never calls any executor", async () => {
    getProposalById.mockResolvedValue(pendingProposal());
    const res = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "prop-1" }) });
    expect(decideProposal).toHaveBeenCalledWith(TEST_SCOPE, "prop-1", "rejected", "u-1", "ui");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
