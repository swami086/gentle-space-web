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

describe("draftReportsChatReply", () => {
  it("tells the user Bifrost isn't configured rather than throwing", async () => {
    isBifrostConfigured.mockReturnValue(false);
    getSession.mockResolvedValue(null);

    const events = await drain(draftReportsChatReply({ history: [], userMessage: "show hot leads" }));

    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("not configured") }]);
  });

  it("retries once on a parse failure, then returns the retried reply", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion
      .mockImplementationOnce(async function* () {
        yield {
          type: "delta",
          content:
            "garbled not a component — way too long to count as a trivial ack because it goes on and on describing things nobody asked for in this reports conversation thread",
        };
      })
      .mockImplementationOnce(async function* () {
        yield { type: "delta", content: "Sure, here are your leads." };
      });

    const events = await drain(draftReportsChatReply({ history: [], userMessage: "show hot leads" }));

    expect(callMeteredStreamingChatCompletion).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toEqual({ type: "done", reply: "Sure, here are your leads." });
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
});
