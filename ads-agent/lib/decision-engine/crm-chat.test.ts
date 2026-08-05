import { beforeEach, describe, expect, it, vi } from "vitest";

const { isBifrostConfigured, streamChatCompletion, callMeteredStreamingChatCompletion, getSession, resolveToolsThenGenerate } =
  vi.hoisted(() => ({
    isBifrostConfigured: vi.fn(),
    streamChatCompletion: vi.fn(),
    callMeteredStreamingChatCompletion: vi.fn(),
    getSession: vi.fn(),
    resolveToolsThenGenerate: vi.fn(),
  }));
vi.mock("../bifrost/client", () => ({ isBifrostConfigured, fallbacksForModel: () => [] }));
vi.mock("../openui/bifrost-stream", () => ({ streamChatCompletion }));
vi.mock("../openui/resolve-tools-then-generate", () => ({ resolveToolsThenGenerate }));
vi.mock("../metering/metered-stream-client", () => ({ callMeteredStreamingChatCompletion }));
vi.mock("../auth/dal", () => ({ getSession }));

import { draftCrmChatReply } from "./crm-chat";
import { InsufficientCreditsError } from "../metering/types";

beforeEach(() => {
  process.env.BIFROST_BASE_URL = "http://localhost:8080";
  isBifrostConfigured.mockReset();
  callMeteredStreamingChatCompletion.mockReset();
  getSession.mockReset();
  resolveToolsThenGenerate.mockReset().mockImplementation(async (_ctx, messages) => messages);
});

async function drain(gen: AsyncGenerator<{ type: "delta"; content: string } | { type: "done"; reply: string }>) {
  const events = [];
  for await (const event of gen) events.push(event);
  return events;
}

function fakeStream(...chunks: string[]) {
  return (async function* () {
    for (const chunk of chunks) yield { type: "delta" as const, content: chunk };
  })();
}

describe("draftCrmChatReply", () => {
  it("calls resolveToolsThenGenerate before streaming, and streams its result forward", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    resolveToolsThenGenerate.mockImplementation(async (_ctx, messages) => [
      ...messages,
      { role: "tool", content: '[{"id":"1"}]', tool_call_id: "call_1" },
    ]);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream("root = OpportunityList([])"));

    const events = await drain(draftCrmChatReply({ history: [], userMessage: "show me hot leads" }));

    expect(resolveToolsThenGenerate).toHaveBeenCalledTimes(1);
    const [, messagesArg] = resolveToolsThenGenerate.mock.calls[0];
    expect(messagesArg.at(-1)).toEqual({ role: "user", content: "show me hot leads" });
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("tells the user Bifrost isn't configured rather than throwing", async () => {
    isBifrostConfigured.mockReturnValue(false);
    getSession.mockResolvedValue(null);

    const events = await drain(draftCrmChatReply({ history: [], userMessage: "show hot leads" }));

    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("not configured") }]);
  });

  it("streams raw model text through, normalized but never rejected or retried", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(
      fakeStream(`OpportunityCard(name="Priya Sharma", stage="NEW_BRIEF", tier="HOT")`),
    );

    const events = await drain(draftCrmChatReply({ history: [], userMessage: "find Priya" }));

    expect(callMeteredStreamingChatCompletion).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual({
      type: "done",
      reply: 'root = OpportunityCard("Priya Sharma", "NEW_BRIEF", "HOT", "", "", "")',
    });
  });

  it("streams a plain-text acknowledgment through unchanged (no component statement)", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream("Sure, here are your leads."));

    const events = await drain(draftCrmChatReply({ history: [], userMessage: "show hot leads" }));

    expect(events.at(-1)).toEqual({ type: "done", reply: "Sure, here are your leads." });
  });

  it("returns a fallback message for an empty model response instead of a generic parse error", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream("   "));

    const events = await drain(draftCrmChatReply({ history: [], userMessage: "show hot leads" }));

    expect(events.at(-1)).toEqual({ type: "done", reply: "I didn't get a response — try asking again." });
  });

  it("returns a generic unavailable message when the model throws a non-credits error", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockImplementationOnce(() => {
      throw new Error("upstream timeout");
    });

    const events = await drain(draftCrmChatReply({ history: [], userMessage: "show spend by corridor" }));

    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("unavailable") }]);
  });

  it("returns the credits-exhausted message when the model call throws InsufficientCreditsError", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockImplementationOnce(() => {
      throw new InsufficientCreditsError();
    });

    const events = await drain(draftCrmChatReply({ history: [], userMessage: "show hot leads" }));

    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("run out of AI credits") }]);
  });
});
