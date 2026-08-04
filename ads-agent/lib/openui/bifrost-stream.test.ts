// ads-agent/lib/openui/bifrost-stream.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamChunk } from "./streaming-types";

function sseResponse(events: string[]): Response {
  const body = events.join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Split into two chunks mid-stream to exercise the buffer-across-reads path.
      const bytes = new TextEncoder().encode(body);
      const mid = Math.floor(bytes.length / 2);
      controller.enqueue(bytes.slice(0, mid));
      controller.enqueue(bytes.slice(mid));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("streamChatCompletion", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.BIFROST_BASE_URL = "http://localhost:8080";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("yields delta chunks then a usage chunk, stopping at [DONE]", async () => {
    const events = [
      `data: {"choices":[{"delta":{"content":"Hello"}}],"model":"gemini-2.5-flash-lite","usage":null}\n\n`,
      `data: {"choices":[{"delta":{"content":", friend."},"finish_reason":"stop"}],"model":"gemini-2.5-flash-lite","usage":{"prompt_tokens":8,"completion_tokens":6,"total_tokens":14}}\n\n`,
      `data: [DONE]\n\n`,
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(events)));

    const { streamChatCompletion } = await import("./bifrost-stream");
    const chunks: StreamChunk[] = [];
    for await (const chunk of streamChatCompletion({ messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "delta", content: "Hello" },
      { type: "delta", content: ", friend." },
      {
        type: "usage",
        model: "gemini-2.5-flash-lite",
        usage: { promptTokens: 8, completionTokens: 6, totalTokens: 14 },
      },
    ]);
  });

  it("skips a malformed SSE line without throwing", async () => {
    const events = [
      `data: not json at all\n\n`,
      `data: {"choices":[{"delta":{"content":"ok"}}],"model":"m","usage":null}\n\n`,
      `data: [DONE]\n\n`,
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(events)));

    const { streamChatCompletion } = await import("./bifrost-stream");
    const chunks: StreamChunk[] = [];
    for await (const chunk of streamChatCompletion({ messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ type: "delta", content: "ok" }]);
  });

  it("throws when BIFROST_BASE_URL is not set", async () => {
    delete process.env.BIFROST_BASE_URL;
    const { streamChatCompletion } = await import("./bifrost-stream");
    await expect(async () => {
      for await (const chunk of streamChatCompletion({ messages: [] })) {
        void chunk;
      }
    }).rejects.toThrow("BIFROST_BASE_URL is not set");
  });
});
