import { afterEach, describe, expect, it, vi } from "vitest";

function sseResponse(events: string[]): Response {
  const body = events.join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("streamHermesChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to /api/hermes/chat with origin, userMessage, and history", async () => {
    const events = [`data: {"done":true,"reply":"hi there"}\n\n`];
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(events));
    vi.stubGlobal("fetch", fetchMock);

    const { streamHermesChat } = await import("./browser-client");
    const chunks = [];
    for await (const chunk of streamHermesChat({ origin: "copilot", userMessage: "hi", history: [] })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ done: true, reply: "hi there" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/hermes/chat");
    expect(JSON.parse(init.body)).toEqual({ userMessage: "hi", history: [], origin: "copilot" });
  });

  it("yields delta events before the final done event", async () => {
    const events = [
      `data: {"delta":"Sp"}\n\n`,
      `data: {"delta":"end is up."}\n\n`,
      `data: {"done":true,"reply":"Spend is up."}\n\n`,
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(events)));

    const { streamHermesChat } = await import("./browser-client");
    const chunks = [];
    for await (const chunk of streamHermesChat({ origin: "reports", userMessage: "hi", history: [] })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ delta: "Sp" }, { delta: "end is up." }, { done: true, reply: "Spend is up." }]);
  });

  it("yields a done/error event when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    const { streamHermesChat } = await import("./browser-client");
    const chunks = [];
    for await (const chunk of streamHermesChat({ origin: "crm", userMessage: "hi", history: [] })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ done: true, error: "Failed to reach Hermes" }]);
  });
});
