import { beforeEach, describe, expect, it, vi } from "vitest";

const { isBifrostConfigured, callMeteredStreamingChatCompletion, getSession } = vi.hoisted(() => ({
  isBifrostConfigured: vi.fn(),
  callMeteredStreamingChatCompletion: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("../bifrost/client", () => ({ isBifrostConfigured }));
vi.mock("../metering/metered-stream-client", () => ({ callMeteredStreamingChatCompletion }));
vi.mock("../auth/dal", () => ({ getSession }));
vi.mock("../openui/bifrost-stream", () => ({ streamChatCompletion: vi.fn() }));

import { draftCopilotReply } from "./copilot-chat";
import { InsufficientCreditsError } from "../metering/types";

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

describe("draftCopilotReply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a fixed message when Bifrost is not configured", async () => {
    isBifrostConfigured.mockReturnValue(false);
    const events = await drain(draftCopilotReply({ history: [], userMessage: "hi" }));
    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("Bifrost is not configured") }]);
  });

  it("streams deltas then yields the parsed root component's raw text on success", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream(`root = StatCard`, `("Leads", "42")`));
    const events = await drain(draftCopilotReply({ history: [], userMessage: "how many leads?" }));
    expect(events[0]).toEqual({ type: "delta", content: "root = StatCard" });
    expect(events[events.length - 1]).toEqual({ type: "done", reply: 'root = StatCard("Leads", "42")' });
  });

  it("accepts a short plain-text acknowledgment with no component statement", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream("Done — paused that campaign."));
    const events = await drain(draftCopilotReply({ history: [], userMessage: "pause it" }));
    expect(events[events.length - 1]).toEqual({ type: "done", reply: "Done — paused that campaign." });
  });

  it("retries once on a parse failure and succeeds if the retry parses", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion
      .mockReturnValueOnce(fakeStream("not valid openui lang at all, way too long to count as a trivial ack because it goes on and on describing things nobody asked for"))
      .mockReturnValueOnce(fakeStream(`root = StatCard("Leads", "42")`));
    const events = await drain(draftCopilotReply({ history: [], userMessage: "how many leads?" }));
    expect(callMeteredStreamingChatCompletion).toHaveBeenCalledTimes(2);
    expect(events[events.length - 1]).toEqual({ type: "done", reply: 'root = StatCard("Leads", "42")' });
  });

  it("gives up gracefully after one failed retry — no silent hang, no third attempt", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    const garbled = "not valid openui lang at all, way too long to count as a trivial ack because it goes on and on describing things nobody asked for";
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream(garbled)).mockReturnValueOnce(fakeStream(garbled));
    const events = await drain(draftCopilotReply({ history: [], userMessage: "how many leads?" }));
    expect(callMeteredStreamingChatCompletion).toHaveBeenCalledTimes(2);
    expect(events[events.length - 1]).toEqual({ type: "done", reply: expect.stringContaining("trouble putting that together") });
  });

  it("returns the credits-exhausted message when the first model call throws InsufficientCreditsError", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockImplementationOnce(() => {
      throw new InsufficientCreditsError();
    });
    const events = await drain(draftCopilotReply({ history: [], userMessage: "hi" }));
    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("run out of AI credits") }]);
  });
});
