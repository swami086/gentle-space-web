import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignDraft, CampaignDraftMessage } from "@/lib/types";

const {
  appendDraftMessage,
  getDraftById,
  listDraftMessages,
  setDraftStatus,
  updateDraftFields,
  draftCampaignChatReply,
} = vi.hoisted(() => ({
  appendDraftMessage: vi.fn(),
  getDraftById: vi.fn(),
  listDraftMessages: vi.fn(),
  setDraftStatus: vi.fn(),
  updateDraftFields: vi.fn(),
  draftCampaignChatReply: vi.fn(),
}));

vi.mock("@/lib/db/campaign-drafts", () => ({
  appendDraftMessage,
  getDraftById,
  listDraftMessages,
  setDraftStatus,
  updateDraftFields,
}));
vi.mock("@/lib/decision-engine/campaign-chat", () => ({ draftCampaignChatReply }));

import { POST } from "./route";

function draft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    id: "draft-1",
    status: "chatting",
    corridor: null,
    dailyBudgetInr: null,
    adGroupName: null,
    keywords: [],
    headlines: [],
    descriptions: [],
    finalUrl: "https://www.gentlespacesolutions.com/spaces",
    proposalId: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

function userMessage(overrides: Partial<CampaignDraftMessage> = {}): CampaignDraftMessage {
  return {
    id: "msg-1",
    draftId: "draft-1",
    role: "user",
    content: "Launch a campaign in Whitefield with a 500rs budget",
    createdAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

function postRequest(body: unknown) {
  return new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/campaign-drafts/[id]/messages", () => {
  it("returns 404 when the draft does not exist", async () => {
    getDraftById.mockResolvedValue(null);
    const res = await POST(postRequest({ content: "hi" }), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the draft is already converted", async () => {
    getDraftById.mockResolvedValue(draft({ status: "converted" }));
    const res = await POST(postRequest({ content: "hi" }), { params: Promise.resolve({ id: "draft-1" }) });
    expect(res.status).toBe(409);
  });

  it("returns 400 for empty content", async () => {
    getDraftById.mockResolvedValue(draft());
    const res = await POST(postRequest({ content: "   " }), { params: Promise.resolve({ id: "draft-1" }) });
    expect(res.status).toBe(400);
    expect(appendDraftMessage).not.toHaveBeenCalled();
  });

  it("appends the user message and the assistant reply when there are no field updates", async () => {
    getDraftById.mockResolvedValue(draft());
    listDraftMessages.mockResolvedValue([userMessage()]);
    draftCampaignChatReply.mockResolvedValue({ reply: "What's your daily budget?", fieldUpdates: null, validationErrors: [] });

    const res = await POST(postRequest({ content: "Launch a campaign in Whitefield" }), { params: Promise.resolve({ id: "draft-1" }) });

    expect(appendDraftMessage).toHaveBeenCalledWith("draft-1", "user", "Launch a campaign in Whitefield");
    expect(appendDraftMessage).toHaveBeenCalledWith("draft-1", "assistant", "What's your daily budget?");
    expect(updateDraftFields).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: "What's your daily budget?", draft: draft() });
  });

  it("persists field updates and marks the draft ready when it becomes complete", async () => {
    const completeDraft = draft({
      status: "ready",
      corridor: "whitefield",
      dailyBudgetInr: 500,
      adGroupName: "Whitefield Office Space",
      keywords: [{ text: "office space whitefield", matchType: "phrase" }],
      headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
      descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
    });
    getDraftById.mockResolvedValueOnce(draft()).mockResolvedValueOnce(completeDraft);
    listDraftMessages.mockResolvedValue([userMessage()]);
    draftCampaignChatReply.mockResolvedValue({
      reply: "Here's your draft — take a look.",
      fieldUpdates: { corridor: "whitefield", dailyBudgetInr: 500 },
      validationErrors: [],
    });
    updateDraftFields.mockResolvedValue(completeDraft);

    const res = await POST(postRequest({ content: "Whitefield, 500 rupees a day" }), { params: Promise.resolve({ id: "draft-1" }) });

    expect(updateDraftFields).toHaveBeenCalledWith("draft-1", { corridor: "whitefield", dailyBudgetInr: 500 });
    expect(setDraftStatus).toHaveBeenCalledWith("draft-1", "ready");
    expect(await res.json()).toEqual({ reply: "Here's your draft — take a look.", draft: completeDraft });
  });
});
