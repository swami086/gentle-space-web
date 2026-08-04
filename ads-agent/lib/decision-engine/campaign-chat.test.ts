import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignDraft } from "../types";
import type { StreamChunk } from "../openui/streaming-types";

const callMeteredStreamingChatCompletion = vi.fn();
vi.mock("../metering/metered-stream-client", () => ({ callMeteredStreamingChatCompletion }));

const streamChatCompletion = vi.fn();
vi.mock("../openui/bifrost-stream", () => ({ streamChatCompletion }));

const getSession = vi.fn();
vi.mock("../auth/dal", () => ({ getSession }));

const { isBifrostConfigured } = vi.hoisted(() => ({
  isBifrostConfigured: vi.fn(() => true),
}));

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

/** SetupCard's Zod key order is fixed: assistantReply, status, corridor, dailyBudgetInr,
 * adGroupName, keywords, headlines, descriptions, finalUrl.
 * OpenUI positional null is rejected for strings (use "") and numbers (use 0 sentinel). */
function setupCardText(fields: Partial<Record<string, unknown>> & { assistantReply: string }): string {
  const f = {
    status: "chatting",
    corridor: "",
    dailyBudgetInr: 0,
    adGroupName: "",
    keywords: [] as unknown[],
    headlines: [] as string[],
    descriptions: [] as string[],
    finalUrl: "https://www.gentlespacesolutions.com/spaces",
    ...fields,
  };
  const corridor = f.corridor === null ? "" : f.corridor;
  const dailyBudgetInr = f.dailyBudgetInr === null ? 0 : f.dailyBudgetInr;
  const adGroupName = f.adGroupName === null ? "" : f.adGroupName;
  return `root = SetupCard(${JSON.stringify(f.assistantReply)}, ${JSON.stringify(f.status)}, ${JSON.stringify(corridor)}, ${dailyBudgetInr}, ${JSON.stringify(adGroupName)}, ${JSON.stringify(f.keywords)}, ${JSON.stringify(f.headlines)}, ${JSON.stringify(f.descriptions)}, ${JSON.stringify(f.finalUrl)})`;
}

async function* fakeMeteredStream(text: string): AsyncGenerator<StreamChunk> {
  yield { type: "delta", content: text };
  yield { type: "usage", model: "gemini-2.5-flash-lite", usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 } };
}

async function collect<T>(gen: AsyncGenerator<T, void, unknown>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe("draftCampaignChatReply", () => {
  beforeEach(() => {
    callMeteredStreamingChatCompletion.mockReset();
    getSession.mockReset();
    isBifrostConfigured.mockReset();
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue({
      userId: "00000000-0000-0000-0000-000000000002",
      email: "operator@x.com",
      orgId: "00000000-0000-0000-0000-000000000001",
      role: "operator",
    });
  });

  it("streams deltas then yields a done event with a clarifying reply", async () => {
    callMeteredStreamingChatCompletion.mockReturnValue(
      fakeMeteredStream(setupCardText({ assistantReply: "What's your daily budget?" })),
    );

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const events = await collect(
      draftCampaignChatReply({ draft: draft(), history: [], userMessage: "I want a campaign in Whitefield" }),
    );

    expect(events[0]).toEqual({ type: "delta", content: setupCardText({ assistantReply: "What's your daily budget?" }) });
    expect(events[1]).toEqual({
      type: "done",
      reply: "What's your daily budget?",
      fieldUpdates: expect.objectContaining({ corridor: null, dailyBudgetInr: null }),
      validationErrors: [],
    });
    expect(callMeteredStreamingChatCompletion).toHaveBeenCalledTimes(1);
    const [ctxArg, requestArg, streamFnArg] = callMeteredStreamingChatCompletion.mock.calls[0];
    expect(ctxArg).toEqual({
      orgId: "00000000-0000-0000-0000-000000000001",
      userId: "00000000-0000-0000-0000-000000000002",
      feature: "ads-agent:campaign-chat",
    });
    expect(streamFnArg).toBe(streamChatCompletion);
    expect(requestArg.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "system" }),
        expect.objectContaining({ role: "user", content: "I want a campaign in Whitefield" }),
      ]),
    );
  });

  it("returns field updates when the model returns a valid SetupCard", async () => {
    callMeteredStreamingChatCompletion.mockReturnValue(
      fakeMeteredStream(
        setupCardText({ assistantReply: "Got it — set the corridor and budget.", corridor: "whitefield", dailyBudgetInr: 500 }),
      ),
    );

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const events = await collect(
      draftCampaignChatReply({ draft: draft(), history: [], userMessage: "Whitefield, 500 rupees a day" }),
    );

    const done = events[events.length - 1];
    expect(done).toEqual({
      type: "done",
      reply: "Got it — set the corridor and budget.",
      fieldUpdates: expect.objectContaining({ corridor: "whitefield", dailyBudgetInr: 500 }),
      validationErrors: [],
    });
  });

  it("retries once when RSA limits are violated, then accepts a corrected response", async () => {
    callMeteredStreamingChatCompletion
      .mockReturnValueOnce(
        fakeMeteredStream(setupCardText({ assistantReply: "Here are headlines.", headlines: ["a".repeat(40)] })),
      )
      .mockReturnValueOnce(
        fakeMeteredStream(setupCardText({ assistantReply: "Fixed.", headlines: ["Short headline"] })),
      );

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const events = await collect(
      draftCampaignChatReply({ draft: draft(), history: [], userMessage: "propose headlines" }),
    );

    expect(callMeteredStreamingChatCompletion).toHaveBeenCalledTimes(2);
    const done = events[events.length - 1];
    expect(done).toEqual({
      type: "done",
      reply: "Fixed.",
      fieldUpdates: expect.objectContaining({ headlines: ["Short headline"] }),
      validationErrors: [],
    });
  });

  it("returns the credits-exhausted reply without streaming deltas when balance is zero", async () => {
    const { InsufficientCreditsError } = await import("../metering/types");
    callMeteredStreamingChatCompletion.mockImplementation(async function* () {
      throw new InsufficientCreditsError("no credits");
    });

    const { draftCampaignChatReply } = await import("./campaign-chat");
    const events = await collect(draftCampaignChatReply({ draft: draft(), history: [], userMessage: "hi" }));

    expect(events).toEqual([
      {
        type: "done",
        reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits.",
        fieldUpdates: null,
        validationErrors: [],
      },
    ]);
  });
});
