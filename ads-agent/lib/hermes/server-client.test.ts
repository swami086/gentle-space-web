import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamChunk } from "../openui/streaming-types";

function sseResponse(events: string[]): Response {
  const body = events.join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder().encode(body);
      const mid = Math.floor(bytes.length / 2);
      controller.enqueue(bytes.slice(0, mid));
      controller.enqueue(bytes.slice(mid));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("streamHermesCompletion", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.HERMES_API_SERVER_URL = "http://127.0.0.1:8642";
    process.env.HERMES_API_SERVER_KEY = "test-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("yields delta chunks then a usage chunk, stopping at [DONE]", async () => {
    const events = [
      `data: {"choices":[{"delta":{"content":"Hi"}}],"model":"google/gemini-2.5-pro"}\n\n`,
      `data: {"choices":[{"delta":{"content":" there."},"finish_reason":"stop"}],"model":"google/gemini-2.5-pro","usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}\n\n`,
      `data: [DONE]\n\n`,
    ];
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(events));
    vi.stubGlobal("fetch", fetchMock);

    const { streamHermesCompletion } = await import("./server-client");
    const chunks: StreamChunk[] = [];
    for await (const chunk of streamHermesCompletion({ messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "delta", content: "Hi" },
      { type: "delta", content: " there." },
      { type: "usage", model: "google/gemini-2.5-pro", usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 } },
    ]);
    const [, requestInit] = fetchMock.mock.calls[0];
    expect(requestInit.headers.Authorization).toBe("Bearer test-key");
  });

  it("maps hermes-agent usage model to google/gemini-2.5-pro for ledger pricing", async () => {
    const events = [
      `data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"model":"hermes-agent","usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\n`,
      `data: [DONE]\n\n`,
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(events)));

    const { streamHermesCompletion } = await import("./server-client");
    const chunks: StreamChunk[] = [];
    for await (const chunk of streamHermesCompletion({ messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "delta", content: "ok" },
      {
        type: "usage",
        model: "google/gemini-2.5-pro",
        usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 },
      },
    ]);
  });

  it("synthesizes a zero-cost usage chunk if the stream ends without one", async () => {
    const events = [
      `data: {"choices":[{"delta":{"content":"ok"}}],"model":"google/gemini-2.5-pro"}\n\n`,
      `data: [DONE]\n\n`,
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(events)));

    const { streamHermesCompletion } = await import("./server-client");
    const chunks: StreamChunk[] = [];
    for await (const chunk of streamHermesCompletion({ messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "delta", content: "ok" },
      { type: "usage", model: "google/gemini-2.5-pro", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
    ]);
  });

  it("throws when HERMES_API_SERVER_URL is not set", async () => {
    delete process.env.HERMES_API_SERVER_URL;
    const { streamHermesCompletion } = await import("./server-client");
    await expect(async () => {
      for await (const chunk of streamHermesCompletion({ messages: [] })) void chunk;
    }).rejects.toThrow("HERMES_API_SERVER_URL is not set");
  });

  it("throws when HERMES_API_SERVER_KEY is not set", async () => {
    delete process.env.HERMES_API_SERVER_KEY;
    const { streamHermesCompletion } = await import("./server-client");
    await expect(async () => {
      for await (const chunk of streamHermesCompletion({ messages: [] })) void chunk;
    }).rejects.toThrow("HERMES_API_SERVER_KEY is not set");
  });

  it("yields a tool_progress chunk for a running hermes.tool.progress event, ignoring the matching completed event", async () => {
    const events = [
      `event: hermes.tool.progress\ndata: {"tool":"list_opportunities","emoji":"🔍","label":"Searching leads","toolCallId":"call_1","status":"running"}\n\n`,
      `data: {"choices":[{"delta":{"content":"Found 3 leads."}}],"model":"google/gemini-2.5-pro"}\n\n`,
      `event: hermes.tool.progress\ndata: {"tool":"list_opportunities","toolCallId":"call_1","status":"completed"}\n\n`,
      `data: {"choices":[{"delta":{},"finish_reason":"stop"}],"model":"google/gemini-2.5-pro","usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}\n\n`,
      `data: [DONE]\n\n`,
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(events)));

    const { streamHermesCompletion } = await import("./server-client");
    const chunks: StreamChunk[] = [];
    for await (const chunk of streamHermesCompletion({ messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "tool_progress", tool: "list_opportunities" },
      { type: "delta", content: "Found 3 leads." },
      { type: "usage", model: "google/gemini-2.5-pro", usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 } },
    ]);
  });
});

describe("isHermesConfigured", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is false when either env var is missing", async () => {
    delete process.env.HERMES_API_SERVER_URL;
    process.env.HERMES_API_SERVER_KEY = "k";
    const { isHermesConfigured } = await import("./server-client");
    expect(isHermesConfigured()).toBe(false);
  });

  it("is true when both env vars are set", async () => {
    process.env.HERMES_API_SERVER_URL = "http://127.0.0.1:8642";
    process.env.HERMES_API_SERVER_KEY = "k";
    const { isHermesConfigured } = await import("./server-client");
    expect(isHermesConfigured()).toBe(true);
  });
});
