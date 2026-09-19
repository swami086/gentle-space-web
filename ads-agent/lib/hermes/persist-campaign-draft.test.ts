import { afterEach, describe, expect, it, vi } from "vitest";
import type { CampaignDraft } from "@/lib/types";

const TEST_SCOPE = { kind: "org" as const, orgId: "org-1" };

const { getDraftById, updateDraftFields, setDraftStatus } = vi.hoisted(() => ({
  getDraftById: vi.fn(),
  updateDraftFields: vi.fn(),
  setDraftStatus: vi.fn(),
}));

vi.mock("@/lib/db/campaign-drafts", () => ({ getDraftById, updateDraftFields, setDraftStatus }));

import { fieldUpdatesFromHermesReply, persistCampaignDraftFromHermesReply } from "./persist-campaign-draft";

const SETUP_CARD = `root = SetupCard("Got it.", "chatting", "whitefield", 500, "Whitefield Office", [{text: "office whitefield", matchType: "phrase"}], ["H1", "H2", "H3"], ["D1", "D2"], "https://www.gentlespacesolutions.com/spaces")`;

function baseDraft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    id: "draft-1",
    orgId: "org-1",
    status: "chatting",
    corridor: null,
    dailyBudgetInr: null,
    adGroupName: null,
    keywords: [],
    headlines: [],
    descriptions: [],
    finalUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("fieldUpdatesFromHermesReply", () => {
  it("returns field updates when reply contains a valid SetupCard", () => {
    const fields = fieldUpdatesFromHermesReply(SETUP_CARD);
    expect(fields).toMatchObject({
      corridor: "whitefield",
      dailyBudgetInr: 500,
      adGroupName: "Whitefield Office",
      finalUrl: "https://www.gentlespacesolutions.com/spaces",
    });
    expect(fields?.keywords).toHaveLength(1);
    expect(fields?.headlines).toHaveLength(3);
  });

  it("returns null when reply has no parseable SetupCard", () => {
    expect(fieldUpdatesFromHermesReply("plain prose answer")).toBeNull();
  });
});

describe("persistCampaignDraftFromHermesReply", () => {
  it("writes draft fields and marks ready when SetupCard completes the draft", async () => {
    const chatting = baseDraft();
    const ready = baseDraft({
      status: "ready",
      corridor: "whitefield",
      dailyBudgetInr: 500,
      adGroupName: "Whitefield Office",
      keywords: [{ text: "office whitefield", matchType: "phrase" }],
      headlines: ["H1", "H2", "H3"],
      descriptions: ["D1", "D2"],
      finalUrl: "https://www.gentlespacesolutions.com/spaces",
    });
    updateDraftFields.mockResolvedValue(ready);
    getDraftById.mockResolvedValue(ready);

    const result = await persistCampaignDraftFromHermesReply(TEST_SCOPE, "draft-1", SETUP_CARD, chatting);

    expect(updateDraftFields).toHaveBeenCalledWith(TEST_SCOPE, "draft-1", expect.objectContaining({ corridor: "whitefield" }));
    expect(setDraftStatus).toHaveBeenCalledWith(TEST_SCOPE, "draft-1", "ready");
    expect(result.status).toBe("ready");
  });

  it("returns the current draft unchanged when reply has no SetupCard", async () => {
    const chatting = baseDraft();
    const result = await persistCampaignDraftFromHermesReply(TEST_SCOPE, "draft-1", "no card here", chatting);
    expect(updateDraftFields).not.toHaveBeenCalled();
    expect(result).toBe(chatting);
  });
});
