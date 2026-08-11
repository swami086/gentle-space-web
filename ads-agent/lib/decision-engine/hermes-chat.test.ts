import { beforeEach, describe, expect, it, vi } from "vitest";

const { isHermesConfigured, callMeteredStreamingChatCompletion, getSession } = vi.hoisted(() => ({
  isHermesConfigured: vi.fn(),
  callMeteredStreamingChatCompletion: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("../hermes/server-client", () => ({ isHermesConfigured, streamHermesCompletion: vi.fn() }));
vi.mock("../metering/metered-stream-client", () => ({ callMeteredStreamingChatCompletion }));
vi.mock("../auth/dal", () => ({ getSession }));

import { draftHermesReply } from "./hermes-chat";
import { InsufficientCreditsError } from "../metering/types";

beforeEach(() => {
  vi.clearAllMocks();
});

async function drain(
  gen: AsyncGenerator<
    { type: "delta"; content: string } | { type: "tool_progress"; tool: string } | { type: "done"; reply: string }
  >,
) {
  const events = [];
  for await (const event of gen) events.push(event);
  return events;
}

type FakeChunk = { type: "delta"; content: string } | { type: "tool_progress"; tool: string };

function fakeStream(...chunks: (string | FakeChunk)[]) {
  return (async function* () {
    for (const chunk of chunks) {
      yield typeof chunk === "string" ? { type: "delta" as const, content: chunk } : chunk;
    }
  })();
}

describe("draftHermesReply", () => {
  it("returns a fixed message when Hermes is not configured", async () => {
    isHermesConfigured.mockReturnValue(false);
    const events = await drain(draftHermesReply({ history: [], userMessage: "hi", origin: "copilot" }));
    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("Hermes isn't configured") }]);
  });

  it("streams deltas then yields the final plain-text reply", async () => {
    isHermesConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream("Spend is up ", "12% week over week."));
    const events = await drain(draftHermesReply({ history: [], userMessage: "how's spend trending?", origin: "reports" }));
    expect(events[0]).toEqual({ type: "delta", content: "Spend is up " });
    expect(events[events.length - 1]).toEqual({ type: "done", reply: "Spend is up 12% week over week." });
  });

  it("tags the metering feature with the given origin", async () => {
    isHermesConfigured.mockReturnValue(true);
    getSession.mockResolvedValue({ orgId: "org-1", userId: "user-1" });
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream("ok"));
    await drain(draftHermesReply({ history: [], userMessage: "hi", origin: "crm" }));
    const [ctx] = callMeteredStreamingChatCompletion.mock.calls[0];
    expect(ctx).toEqual({ orgId: "org-1", userId: "user-1", feature: "ads-agent:hermes-chat:crm" });
  });

  it("returns the credits-exhausted message when the model throws InsufficientCreditsError", async () => {
    isHermesConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockImplementationOnce(() => {
      throw new InsufficientCreditsError();
    });
    const events = await drain(draftHermesReply({ history: [], userMessage: "hi", origin: "campaign" }));
    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("run out of AI credits") }]);
  });

  it("returns a generic unavailable message on a non-credits error", async () => {
    isHermesConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockImplementationOnce(() => {
      throw new Error("upstream timeout");
    });
    const events = await drain(draftHermesReply({ history: [], userMessage: "hi", origin: "copilot" }));
    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("unavailable") }]);
  });

  it("returns a fallback message for an empty model response", async () => {
    isHermesConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream(""));
    const events = await drain(draftHermesReply({ history: [], userMessage: "hi", origin: "copilot" }));
    expect(events[events.length - 1]).toEqual({ type: "done", reply: "I didn't get a response — try asking again." });
  });

  it("forwards tool_progress events from the model stream before the final done event", async () => {
    isHermesConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(
      fakeStream({ type: "tool_progress", tool: "list_opportunities" }, "Found 3 leads."),
    );
    const events = await drain(draftHermesReply({ history: [], userMessage: "which leads are hot?", origin: "crm" }));
    expect(events[0]).toEqual({ type: "tool_progress", tool: "list_opportunities" });
    expect(events[events.length - 1]).toEqual({ type: "done", reply: "Found 3 leads." });
  });

  it("no longer instructs the model to avoid OpenUI-lang", async () => {
    isHermesConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream("ok"));
    await drain(draftHermesReply({ history: [], userMessage: "hi", origin: "copilot" }));
    const [, request] = callMeteredStreamingChatCompletion.mock.calls[0];
    const systemContent = request.messages[0].content as string;
    expect(systemContent).not.toContain("never emit OpenUI-lang");
    expect(systemContent).toContain("OpportunityCard");
  });
});
