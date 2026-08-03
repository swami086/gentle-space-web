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

function jsonResponse(payload: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: JSON.stringify(payload) } }],
    }),
    { status: 200 },
  );
}

describe("draftCampaignChatReply", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      BIFROST_BASE_URL: "http://localhost:8080",
      BIFROST_CHAT_MODEL: "vertex/gemini-2.5-flash-lite",
    };
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns a clarifying question when the model only sends assistantReply", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ assistantReply: "What's your daily budget?" }));
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "I want a campaign in Whitefield" });

    expect(result).toEqual({ reply: "What's your daily budget?", fieldUpdates: {}, validationErrors: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "system" }),
        expect.objectContaining({ role: "user", content: "I want a campaign in Whitefield" }),
      ]),
    );
    expect(body.fallbacks).toContain("vertex/gemini-2.5-flash");
  });

  it("returns field updates when the model returns valid draft JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
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

  it("rejects RSA-limit violations and returns corrected fields on retry", async () => {
    const tooLong = "This headline is deliberately far too long for Google RSA limits";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ assistantReply: "Drafted.", headlines: [tooLong] }))
      .mockResolvedValueOnce(jsonResponse({ assistantReply: "Fixed it.", headlines: ["Short Headline"] }));
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "Write me a headline" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondCallBody.messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringMatching(/Rejected:/),
    });
    expect(result).toEqual({ reply: "Fixed it.", fieldUpdates: { headlines: ["Short Headline"] }, validationErrors: [] });
  });

  it("gives up gracefully if the retry still violates RSA limits", async () => {
    const tooLong = "This headline is deliberately far too long for Google RSA limits";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ assistantReply: "", headlines: [tooLong] }))
      .mockResolvedValueOnce(jsonResponse({ assistantReply: "", headlines: [tooLong] }));
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "Write me a headline" });

    expect(result.fieldUpdates).toBeNull();
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });

  it("rewrites claim-without-fields replies so the chat does not pretend copy was written", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        assistantReply: "Okay, here are some headlines and descriptions for the ad copy. Let me know what you think!",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "you assume and propose" });

    expect(result.fieldUpdates).toEqual({});
    expect(result.reply).not.toMatch(/here are some headlines/i);
    expect(result.reply).toMatch(/setup card/i);
  });

  it("silently tops up missing descriptions when the user asked to propose copy", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          assistantReply: "Drafted headlines.",
          headlines: ["Office in Whitefield", "Lease Office Space", "Bangalore CRE"],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          assistantReply: "Added descriptions too.",
          descriptions: ["Find verified Whitefield offices with AI search.", "Lease commercial space with Gentle Space."],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "you assume and propose" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.fieldUpdates?.descriptions).toHaveLength(2);
    expect(result.reply).toBe("Added descriptions too.");
  });

  it("returns a friendly message without calling fetch when Bifrost is not configured", async () => {
    delete process.env.BIFROST_BASE_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "hi" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.fieldUpdates).toBeNull();
    expect(result.reply).toContain("Bifrost");
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
