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

beforeEach(() => {
  vi.clearAllMocks();
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

describe("draftCopilotReply", () => {
  it("returns a fixed message when Bifrost is not configured", async () => {
    isBifrostConfigured.mockReturnValue(false);
    const events = await drain(draftCopilotReply({ history: [], userMessage: "hi" }));
    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("Bifrost is not configured") }]);
  });

  it("streams deltas then yields the raw (normalized) text on success", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream(`root = StatCard`, `("Leads", "42")`));
    const events = await drain(draftCopilotReply({ history: [], userMessage: "how many leads?" }));
    expect(events[0]).toEqual({ type: "delta", content: "root = StatCard" });
    expect(events[events.length - 1]).toEqual({ type: "done", reply: 'root = StatCard("Leads", "42")' });
  });

  it("streams a named-kwargs component through, normalized to positional (no server rejection)", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(
      fakeStream(`StatCard(label="Pipeline", value="₹12L")`),
    );
    const events = await drain(draftCopilotReply({ history: [], userMessage: "what's my pipeline?" }));
    expect(events[events.length - 1]).toEqual({
      type: "done",
      reply: 'root = StatCard("Pipeline", "₹12L", "", "flat")',
    });
  });

  it("accepts a short plain-text acknowledgment with no component statement", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream("Done — paused that campaign."));
    const events = await drain(draftCopilotReply({ history: [], userMessage: "pause it" }));
    expect(events[events.length - 1]).toEqual({ type: "done", reply: "Done — paused that campaign." });
  });

  it("returns a fallback message for an empty model response instead of a generic parse error", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream(""));
    const events = await drain(draftCopilotReply({ history: [], userMessage: "hi" }));
    expect(events[events.length - 1]).toEqual({ type: "done", reply: "I didn't get a response — try asking again." });
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

  it("returns a generic unavailable message when the model throws a non-credits error", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockImplementationOnce(() => {
      throw new Error("upstream timeout");
    });
    const events = await drain(draftCopilotReply({ history: [], userMessage: "hi" }));
    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("unavailable") }]);
  });

  it("includes CRM Query tool guidance in the system prompt (Generate→Execute)", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(
      fakeStream('opps = Query("list_opportunities", {}, [])\nroot = OpportunityList(opps)'),
    );

    const events = await drain(draftCopilotReply({ history: [], userMessage: "show me hot leads" }));

    const [, options] = callMeteredStreamingChatCompletion.mock.calls[0];
    expect(options.messages[0].content).toContain('Query("list_opportunities"');
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});
