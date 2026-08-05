import { beforeEach, describe, expect, it, vi } from "vitest";

const { isBifrostConfigured, streamChatCompletion, callMeteredStreamingChatCompletion, getSession } = vi.hoisted(() => ({
  isBifrostConfigured: vi.fn(),
  streamChatCompletion: vi.fn(),
  callMeteredStreamingChatCompletion: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("../bifrost/client", () => ({ isBifrostConfigured, fallbacksForModel: () => [] }));
vi.mock("../openui/bifrost-stream", () => ({ streamChatCompletion }));
vi.mock("../metering/metered-stream-client", () => ({ callMeteredStreamingChatCompletion }));
vi.mock("../auth/dal", () => ({ getSession }));

import { draftReportsChatReply } from "./reports-chat";
import { InsufficientCreditsError } from "../metering/types";

beforeEach(() => {
  isBifrostConfigured.mockReset();
  callMeteredStreamingChatCompletion.mockReset();
  getSession.mockReset();
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

describe("draftReportsChatReply", () => {
  it("tells the user Bifrost isn't configured rather than throwing", async () => {
    isBifrostConfigured.mockReturnValue(false);
    getSession.mockResolvedValue(null);

    const events = await drain(draftReportsChatReply({ history: [], userMessage: "show CPL trend" }));

    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("not configured") }]);
  });

  it("streams raw model text through, normalized but never rejected or retried", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(
      fakeStream(`TrendChart(title="CPL Trend This Week", points=[])`),
    );

    const events = await drain(draftReportsChatReply({ history: [], userMessage: "show CPL trend this week" }));

    expect(callMeteredStreamingChatCompletion).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual({
      type: "done",
      reply: 'root = TrendChart("CPL Trend This Week", [])',
    });
  });

  it("streams a plain-text acknowledgment through unchanged", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream("No data for that range yet."));

    const events = await drain(draftReportsChatReply({ history: [], userMessage: "show spend last month" }));

    expect(events.at(-1)).toEqual({ type: "done", reply: "No data for that range yet." });
  });

  it("returns a fallback message for an empty model response instead of a generic parse error", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream(""));

    const events = await drain(draftReportsChatReply({ history: [], userMessage: "show CPL trend" }));

    expect(events.at(-1)).toEqual({ type: "done", reply: "I didn't get a response — try asking again." });
  });

  it("returns a generic unavailable message when the model throws a non-credits error", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockImplementationOnce(() => {
      throw new Error("upstream timeout");
    });

    const events = await drain(draftReportsChatReply({ history: [], userMessage: "show spend by corridor" }));

    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("unavailable") }]);
  });

  it("returns the credits-exhausted message when the model call throws InsufficientCreditsError", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockImplementationOnce(() => {
      throw new InsufficientCreditsError();
    });

    const events = await drain(draftReportsChatReply({ history: [], userMessage: "show CPL trend" }));

    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("run out of AI credits") }]);
  });
});
