import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignDraft } from "../types";

vi.mock("../vertex/auth", () => ({
  getVertexAccessToken: vi.fn().mockResolvedValue("test-token"),
}));

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

function toolCallResponse(args: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "update_campaign_draft", args } }] } }],
    }),
    { status: 200 },
  );
}

function plainReplyResponse(text: string) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] } }] }),
    { status: 200 },
  );
}

describe("draftCampaignChatReply", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GOOGLE_CLOUD_PROJECT: "test-project",
      GOOGLE_APPLICATION_CREDENTIALS: "/tmp/fake-vertex-key.json",
    };
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns a clarifying question when the model makes no tool call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainReplyResponse("What's your daily budget?"));
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "I want a campaign in Whitefield" });

    expect(result).toEqual({ reply: "What's your daily budget?", fieldUpdates: null, validationErrors: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns field updates when the model calls update_campaign_draft with valid fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      toolCallResponse({
        assistantReply: "Got it — set the corridor and budget.",
        corridor: "whitefield",
        dailyBudgetInr: 500,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "Whitefield, 500 rupees a day" });

    expect(result).toEqual({
      reply: "Got it — set the corridor and budget.",
      fieldUpdates: { corridor: "whitefield", dailyBudgetInr: 500 },
      validationErrors: [],
    });
  });

  it("rejects RSA-limit violations with a synthetic function response and returns the corrected fields on retry", async () => {
    const tooLong = "This headline is deliberately far too long for Google RSA limits";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse({ assistantReply: "", headlines: [tooLong] }))
      .mockResolvedValueOnce(toolCallResponse({ assistantReply: "Fixed it.", headlines: ["Short Headline"] }));
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "Write me a headline" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondCallBody.contents.at(-1)).toMatchObject({
      role: "user",
      parts: [{ functionResponse: { name: "update_campaign_draft" } }],
    });
    expect(result).toEqual({ reply: "Fixed it.", fieldUpdates: { headlines: ["Short Headline"] }, validationErrors: [] });
  });

  it("gives up gracefully if the retry still violates RSA limits", async () => {
    const tooLong = "This headline is deliberately far too long for Google RSA limits";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse({ assistantReply: "", headlines: [tooLong] }))
      .mockResolvedValueOnce(toolCallResponse({ assistantReply: "", headlines: [tooLong] }));
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "Write me a headline" });

    expect(result.fieldUpdates).toBeNull();
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });

  it("returns a friendly message without calling fetch when Vertex AI is not configured", async () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "hi" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.fieldUpdates).toBeNull();
    expect(result.reply).toContain("Vertex AI");
  });

  it("returns a friendly message when the API call is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "hi" });
    expect(result.fieldUpdates).toBeNull();
    expect(result.reply).toMatch(/unavailable/i);
  });

  it("returns a friendly message when fetch throws (network/timeout)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "hi" });
    expect(result.fieldUpdates).toBeNull();
    expect(result.reply).toMatch(/unavailable/i);
  });
});
