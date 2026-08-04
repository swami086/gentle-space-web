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

/** Reads a `data: {...}\n\n` SSE Response body into an array of parsed events. */
async function readEvents(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line.replace(/^data: /, "")));
}

async function* singleDoneEvent(event: Record<string, unknown>) {
  yield event;
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

  it("streams no deltas and a done event when there are no field updates", async () => {
    getDraftById.mockResolvedValue(draft());
    listDraftMessages.mockResolvedValue([userMessage()]);
    draftCampaignChatReply.mockReturnValue(
      singleDoneEvent({ type: "done", reply: "What's your daily budget?", fieldUpdates: null, validationErrors: [] }),
    );

    const res = await POST(postRequest({ content: "Launch a campaign in Whitefield" }), {
      params: Promise.resolve({ id: "draft-1" }),
    });

    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const events = await readEvents(res);
    expect(events).toEqual([{ done: true, reply: "What's your daily budget?", draft: draft() }]);
    expect(appendDraftMessage).toHaveBeenCalledWith("draft-1", "user", "Launch a campaign in Whitefield");
    expect(appendDraftMessage).toHaveBeenCalledWith("draft-1", "assistant", "What's your daily budget?");
    expect(updateDraftFields).not.toHaveBeenCalled();
  });

  it("streams deltas, persists field updates, and marks the draft ready when it becomes complete", async () => {
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
    draftCampaignChatReply.mockImplementation(async function* () {
      yield { type: "delta", content: "root = SetupCard(" };
      yield { type: "delta", content: "\"Here's your draft.\", \"ready\", \"whitefield\", 500, ...)" };
      yield {
        type: "done",
        reply: "Here's your draft — take a look.",
        fieldUpdates: { corridor: "whitefield", dailyBudgetInr: 500 },
        validationErrors: [],
      };
    });
    updateDraftFields.mockResolvedValue(completeDraft);

    const res = await POST(postRequest({ content: "Whitefield, 500 rupees a day" }), {
      params: Promise.resolve({ id: "draft-1" }),
    });

    const events = await readEvents(res);
    expect(events[0]).toEqual({ delta: "root = SetupCard(" });
    expect(events[1]).toEqual({ delta: expect.stringContaining("whitefield") });
    expect(events[2]).toEqual({ done: true, reply: "Here's your draft — take a look.", draft: completeDraft });
    expect(updateDraftFields).toHaveBeenCalledWith("draft-1", { corridor: "whitefield", dailyBudgetInr: 500 });
    expect(setDraftStatus).toHaveBeenCalledWith("draft-1", "ready");
  });
});
