import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignDraft } from "../types";

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

function toolCallResponse(args: Record<string, unknown>, content = "") {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "update_campaign_draft", arguments: JSON.stringify(args) } },
            ],
          },
        },
      ],
    }),
    { status: 200 },
  );
}

function plainReplyResponse(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

describe("draftCampaignChatReply", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, OPENAI_API_KEY: "test-key" };
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
      toolCallResponse({ corridor: "whitefield", dailyBudgetInr: 500 }, "Got it — set the corridor and budget."),
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

  it("rejects RSA-limit violations with a synthetic tool result and returns the corrected fields on retry", async () => {
    const tooLong = "This headline is deliberately far too long for Google RSA limits";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse({ headlines: [tooLong] }))
      .mockResolvedValueOnce(toolCallResponse({ headlines: ["Short Headline"] }, "Fixed it."));
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "Write me a headline" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondCallBody.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_1" });
    expect(result).toEqual({ reply: "Fixed it.", fieldUpdates: { headlines: ["Short Headline"] }, validationErrors: [] });
  });

  it("gives up gracefully if the retry still violates RSA limits", async () => {
    const tooLong = "This headline is deliberately far too long for Google RSA limits";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse({ headlines: [tooLong] }))
      .mockResolvedValueOnce(toolCallResponse({ headlines: [tooLong] }));
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "Write me a headline" });

    expect(result.fieldUpdates).toBeNull();
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });

  it("returns a friendly message without calling fetch when OPENAI_API_KEY is unset", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "hi" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.fieldUpdates).toBeNull();
    expect(result.reply).toContain("OPENAI_API_KEY");
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
