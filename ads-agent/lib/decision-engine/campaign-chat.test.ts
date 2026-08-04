import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignDraft } from "../types";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";

const { callMeteredChatCompletion, isBifrostConfigured } = vi.hoisted(() => ({
  callMeteredChatCompletion: vi.fn(),
  isBifrostConfigured: vi.fn(() => true),
}));

vi.mock("../metering/metered-client", () => ({ callMeteredChatCompletion }));
vi.mock("../bifrost/client", async () => {
  const actual = await vi.importActual<typeof import("../bifrost/client")>("../bifrost/client");
  return { ...actual, isBifrostConfigured };
});

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
  return { choices: [{ message: { role: "assistant", content: JSON.stringify(payload) } }] };
}

describe("draftCampaignChatReply", () => {
  beforeEach(() => {
    callMeteredChatCompletion.mockReset();
    isBifrostConfigured.mockReset();
    isBifrostConfigured.mockReturnValue(true);
  });

  it("returns a clarifying question when the model only sends assistantReply", async () => {
    callMeteredChatCompletion.mockResolvedValue(jsonResponse({ assistantReply: "What's your daily budget?" }));

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "I want a campaign in Whitefield" });

    expect(result).toEqual({ reply: "What's your daily budget?", fieldUpdates: {}, validationErrors: [] });
    expect(callMeteredChatCompletion).toHaveBeenCalledTimes(1);
    expect(callMeteredChatCompletion.mock.calls[0][0]).toEqual({
      orgId: DEFAULT_ORG_ID,
      userId: DEFAULT_USER_ID,
      feature: "ads-agent:campaign-chat",
    });
    const request = callMeteredChatCompletion.mock.calls[0][1];
    expect(request.responseFormat?.type).toBe("json_schema");
    expect(request.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "system" }),
        expect.objectContaining({ role: "user", content: "I want a campaign in Whitefield" }),
      ]),
    );
  });

  it("returns field updates when the model returns valid draft JSON", async () => {
    callMeteredChatCompletion.mockResolvedValue(
      jsonResponse({
        assistantReply: "Got it — set the corridor and budget.",
        corridor: "whitefield",
        dailyBudgetInr: 500,
      }),
    );

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
    callMeteredChatCompletion
      .mockResolvedValueOnce(jsonResponse({ assistantReply: "Drafted.", headlines: [tooLong] }))
      .mockResolvedValueOnce(jsonResponse({ assistantReply: "Fixed it.", headlines: ["Short Headline"] }));

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "Write me a headline" });

    expect(callMeteredChatCompletion).toHaveBeenCalledTimes(2);
    const secondCallRequest = callMeteredChatCompletion.mock.calls[1][1];
    expect(secondCallRequest.messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringMatching(/Rejected:/),
    });
    expect(result).toEqual({ reply: "Fixed it.", fieldUpdates: { headlines: ["Short Headline"] }, validationErrors: [] });
  });

  it("gives up gracefully if the retry still violates RSA limits", async () => {
    const tooLong = "This headline is deliberately far too long for Google RSA limits";
    callMeteredChatCompletion
      .mockResolvedValueOnce(jsonResponse({ assistantReply: "", headlines: [tooLong] }))
      .mockResolvedValueOnce(jsonResponse({ assistantReply: "", headlines: [tooLong] }));

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "Write me a headline" });

    expect(result.fieldUpdates).toBeNull();
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });

  it("rewrites claim-without-fields replies so the chat does not pretend copy was written", async () => {
    callMeteredChatCompletion.mockResolvedValue(
      jsonResponse({
        assistantReply: "Okay, here are some headlines and descriptions for the ad copy. Let me know what you think!",
      }),
    );

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "you assume and propose" });

    expect(result.fieldUpdates).toEqual({});
    expect(result.reply).not.toMatch(/here are some headlines/i);
    expect(result.reply).toMatch(/setup card/i);
  });

  it("silently tops up missing descriptions when the user asked to propose copy", async () => {
    callMeteredChatCompletion
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

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "you assume and propose" });

    expect(callMeteredChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.fieldUpdates?.descriptions).toHaveLength(2);
    expect(result.reply).toBe("Added descriptions too.");
  });

  it("returns a friendly message without calling the metered client when Bifrost is not configured", async () => {
    isBifrostConfigured.mockReturnValue(false);

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "hi" });

    expect(callMeteredChatCompletion).not.toHaveBeenCalled();
    expect(result.fieldUpdates).toBeNull();
    expect(result.reply).toContain("Bifrost");
  });

  it("returns a friendly message when the API call is not ok", async () => {
    callMeteredChatCompletion.mockRejectedValue(new Error("Bifrost 500"));
    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "hi" });
    expect(result.fieldUpdates).toBeNull();
    expect(result.reply).toMatch(/unavailable/i);
  });

  it("returns a friendly message when the metered client throws (network/timeout)", async () => {
    callMeteredChatCompletion.mockRejectedValue(new Error("network down"));
    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "hi" });
    expect(result.fieldUpdates).toBeNull();
    expect(result.reply).toMatch(/unavailable/i);
  });

  it("returns a friendly message and no field updates when credits are exhausted", async () => {
    const { InsufficientCreditsError } = await import("../metering/types");
    callMeteredChatCompletion.mockRejectedValue(new InsufficientCreditsError("out of credits"));
    const { draftCampaignChatReply } = await import("./campaign-chat");
    const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "hi" });
    expect(result.fieldUpdates).toBeNull();
    expect(result.reply).toMatch(/credit/i);
  });
});
