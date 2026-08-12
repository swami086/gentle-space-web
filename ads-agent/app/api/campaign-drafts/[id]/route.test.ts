import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignDraft } from "@/lib/types";

const { getDraftById, updateDraftFields, setDraftStatus, requireApiRole, scopeForSession } = vi.hoisted(() => ({
  getDraftById: vi.fn(),
  updateDraftFields: vi.fn(),
  setDraftStatus: vi.fn(),
  requireApiRole: vi.fn(),
  scopeForSession: vi.fn(),
}));

vi.mock("@/lib/db/campaign-drafts", () => ({ getDraftById, updateDraftFields, setDraftStatus }));
vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));
vi.mock("@/lib/auth/scope-interim", () => ({ scopeForSession }));

import { PATCH } from "./route";

const TEST_SCOPE = { kind: "org" as const, orgId: "org-1" };

function draft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    id: "draft-1",
    status: "chatting",
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

describe("PATCH /api/campaign-drafts/[id]", () => {
  it("returns 404 when the draft does not exist", async () => {
    getDraftById.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ corridor: "hsr" }), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the draft is already converted", async () => {
    getDraftById.mockResolvedValue(draft({ status: "converted" }));
    const res = await PATCH(patchRequest({ corridor: "hsr" }), { params: Promise.resolve({ id: "draft-1" }) });
    expect(res.status).toBe(409);
    expect(updateDraftFields).not.toHaveBeenCalled();
  });

  it("returns 422 for an RSA-limit violation and does not write", async () => {
    getDraftById.mockResolvedValue(draft());
    const res = await PATCH(
      patchRequest({ headlines: ["This headline is deliberately far too long for Google RSA"] }),
      { params: Promise.resolve({ id: "draft-1" }) },
    );
    expect(res.status).toBe(422);
    expect(updateDraftFields).not.toHaveBeenCalled();
  });

  it("saves the patch and recomputes status to ready when the draft is now complete", async () => {
    getDraftById.mockResolvedValueOnce(draft({ status: "chatting", corridor: null })).mockResolvedValueOnce(draft());
    updateDraftFields.mockResolvedValue(draft());

    const res = await PATCH(patchRequest({ corridor: "whitefield" }), { params: Promise.resolve({ id: "draft-1" }) });

    expect(updateDraftFields).toHaveBeenCalledWith(TEST_SCOPE, "draft-1", { corridor: "whitefield" });
    expect(setDraftStatus).toHaveBeenCalledWith(TEST_SCOPE, "draft-1", "ready");
    expect(res.status).toBe(200);
    expect((await res.json()).draft).toEqual(draft());
  });

  it("recomputes status to chatting when the draft is still incomplete", async () => {
    const incomplete = draft({ status: "chatting", headlines: [] });
    getDraftById.mockResolvedValueOnce(draft()).mockResolvedValueOnce(incomplete);
    updateDraftFields.mockResolvedValue(incomplete);

    await PATCH(patchRequest({ headlines: [] }), { params: Promise.resolve({ id: "draft-1" }) });

    expect(setDraftStatus).toHaveBeenCalledWith(TEST_SCOPE, "draft-1", "chatting");
  });
});
