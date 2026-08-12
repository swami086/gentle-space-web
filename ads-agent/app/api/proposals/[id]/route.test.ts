import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "@/lib/types";

const { getProposalById, updateProposalPayload, requireApiRole, scopeForSession } = vi.hoisted(() => ({
  getProposalById: vi.fn(),
  updateProposalPayload: vi.fn(),
  requireApiRole: vi.fn(),
  scopeForSession: vi.fn(),
}));

vi.mock("@/lib/db/proposals", () => ({ getProposalById, updateProposalPayload }));
vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));
vi.mock("@/lib/auth/scope-interim", () => ({ scopeForSession }));

import { PATCH } from "./route";

const TEST_SCOPE = { kind: "org" as const, orgId: "org-1" };

function pendingCreateCampaignProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "prop-1",
    kind: "create_campaign",
    campaignId: null,
    payload: {
      corridor: "whitefield",
      platform: "google",
      dailyBudgetInr: 500,
      adGroupName: "Whitefield Office Space",
      keywords: [{ text: "office space whitefield", matchType: "phrase" }],
      negativeKeywords: ["residential"],
      headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
      descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
      finalUrl: "https://www.gentlespacesolutions.com/spaces",
    },
    triggeredRule: "manual_campaign_creation",
    rationale: null,
    status: "pending",
    error: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    decidedAt: null,
    executedAt: null,
    ...overrides,
  };
}

function patchRequest(body: unknown) {
  return new Request("http://localhost", { method: "PATCH", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireApiRole.mockResolvedValue({
    ok: true,
    session: { userId: "u-1", email: "a@b.com", orgId: "org-1", role: "operator" },
  });
  scopeForSession.mockResolvedValue(TEST_SCOPE);
});

describe("PATCH /api/proposals/[id]", () => {
  it("returns 404 when the proposal does not exist", async () => {
    getProposalById.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ dailyBudgetInr: 600 }), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-create_campaign proposal", async () => {
    getProposalById.mockResolvedValue(pendingCreateCampaignProposal({ kind: "pause" }));
    const res = await PATCH(patchRequest({ dailyBudgetInr: 600 }), { params: Promise.resolve({ id: "prop-1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 409 when the proposal is not pending", async () => {
    getProposalById.mockResolvedValue(pendingCreateCampaignProposal({ status: "approved" }));
    const res = await PATCH(patchRequest({ dailyBudgetInr: 600 }), { params: Promise.resolve({ id: "prop-1" }) });
    expect(res.status).toBe(409);
  });

  it("returns 422 when a headline exceeds the RSA character limit", async () => {
    getProposalById.mockResolvedValue(pendingCreateCampaignProposal());
    const res = await PATCH(
      patchRequest({ headlines: ["This headline is deliberately far too long for Google RSA"] }),
      { params: Promise.resolve({ id: "prop-1" }) },
    );
    expect(res.status).toBe(422);
    expect(updateProposalPayload).not.toHaveBeenCalled();
  });

  it("merges the patch into the existing payload and saves it", async () => {
    const existing = pendingCreateCampaignProposal();
    getProposalById.mockResolvedValue(existing);
    updateProposalPayload.mockResolvedValue({ ...existing, payload: { ...existing.payload, dailyBudgetInr: 700 } });

    const res = await PATCH(patchRequest({ dailyBudgetInr: 700 }), { params: Promise.resolve({ id: "prop-1" }) });

    expect(updateProposalPayload).toHaveBeenCalledWith(
      TEST_SCOPE,
      "prop-1",
      expect.objectContaining({ corridor: "whitefield", dailyBudgetInr: 700 }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).payload.dailyBudgetInr).toBe(700);
  });
});
