import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignDraft, Proposal } from "@/lib/types";

const TEST_SCOPE = { kind: "org" as const, orgId: "org-1" };

const { getDraftById, markDraftConverted, createProposal, guard } = vi.hoisted(() => ({
  getDraftById: vi.fn(),
  markDraftConverted: vi.fn(),
  createProposal: vi.fn(),
  guard: vi.fn(),
}));

vi.mock("@/lib/db/campaign-drafts", () => ({ getDraftById, markDraftConverted }));
vi.mock("@/lib/db/proposals", () => ({ createProposal }));
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

function readyDraft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    id: "draft-1",
    status: "ready",
    corridor: "whitefield",
    dailyBudgetInr: 500,
    adGroupName: "Whitefield Office Space",
    keywords: [{ text: "office space whitefield", matchType: "phrase" }],
    headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
    descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
    finalUrl: "https://www.gentlespacesolutions.com/spaces",
    proposalId: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "prop-1",
    kind: "create_campaign",
    campaignId: null,
    payload: {},
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

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({
    ok: true,
    session: { userId: "u-1", email: "a@b.com", orgId: "org-1", role: "operator" },
    scope: TEST_SCOPE,
  });
});

describe("POST /api/campaign-drafts/[id]/create-proposal", () => {
  it("returns 404 when the draft does not exist", async () => {
    getDraftById.mockResolvedValue(null);
    const res = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the draft is not ready", async () => {
    getDraftById.mockResolvedValue(readyDraft({ status: "chatting" }));
    const res = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: "draft-1" }) });
    expect(res.status).toBe(409);
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("converts a ready draft into a pending create_campaign proposal", async () => {
    getDraftById.mockResolvedValue(readyDraft());
    createProposal.mockResolvedValue(proposal());

    const res = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: "draft-1" }) });

    expect(createProposal).toHaveBeenCalledWith(
      TEST_SCOPE,
      expect.objectContaining({
        kind: "create_campaign",
        payload: expect.objectContaining({
          corridor: "whitefield",
          platform: "google",
          dailyBudgetInr: 500,
          negativeKeywords: expect.any(Array),
        }),
      }),
    );
    expect(markDraftConverted).toHaveBeenCalledWith(TEST_SCOPE, "draft-1", "prop-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ proposalId: "prop-1" });
  });
});
