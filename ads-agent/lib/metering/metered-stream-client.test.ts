import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamChatCompletionFn, StreamChunk } from "../openui/streaming-types";

const getOrgBalance = vi.fn();
const getUserCap = vi.fn();
const debitUsage = vi.fn();
vi.mock("./ledger", () => ({ getOrgBalance, getUserCap, debitUsage }));

const computeCostUsd = vi.fn(() => 0.001);
const creditsFromCostUsd = vi.fn(() => 0.1);
vi.mock("./pricing", () => ({ computeCostUsd, creditsFromCostUsd }));

function fakeStream(chunks: StreamChunk[]): StreamChatCompletionFn {
  return async function* () {
    for (const chunk of chunks) yield chunk;
  };
}

describe("callMeteredStreamingChatCompletion", () => {
  beforeEach(() => {
    getOrgBalance.mockReset().mockResolvedValue(100);
    getUserCap.mockReset().mockResolvedValue(null);
    debitUsage.mockReset();
    computeCostUsd.mockClear();
    creditsFromCostUsd.mockClear();
  });

  it("forwards every chunk and debits once, from the usage chunk", async () => {
    const { callMeteredStreamingChatCompletion } = await import("./metered-stream-client");
    const streamFn = fakeStream([
      { type: "delta", content: "hi" },
      { type: "delta", content: " there" },
      { type: "usage", model: "gemini-2.5-flash-lite", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
    ]);

    const ctx = { orgId: "org-1", userId: "user-1", feature: "test" };
    const seen: StreamChunk[] = [];
    for await (const chunk of callMeteredStreamingChatCompletion(ctx, { messages: [] }, streamFn)) {
      seen.push(chunk);
    }

    expect(seen).toHaveLength(3);
    expect(debitUsage).toHaveBeenCalledTimes(1);
    expect(debitUsage).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", userId: "user-1", model: "gemini-2.5-flash-lite", promptTokens: 10 }),
    );
  });

  it("throws when the stream ends without a usage chunk and does not debit", async () => {
    const { callMeteredStreamingChatCompletion } = await import("./metered-stream-client");
    const streamFn = fakeStream([
      { type: "delta", content: "hi" },
      { type: "delta", content: " there" },
    ]);

    const ctx = { orgId: "org-1", userId: "user-1", feature: "test" };
    await expect(async () => {
      for await (const chunk of callMeteredStreamingChatCompletion(ctx, { messages: [] }, streamFn)) {
        void chunk;
      }
    }).rejects.toThrow("stream ended without a usage chunk — no debit recorded");
    expect(debitUsage).not.toHaveBeenCalled();
  });

  it("throws InsufficientCreditsError before calling streamFn when org balance is zero", async () => {
    getOrgBalance.mockResolvedValue(0);
    const { callMeteredStreamingChatCompletion } = await import("./metered-stream-client");
    const { InsufficientCreditsError } = await import("./types");
    const streamFn = vi.fn(fakeStream([]));

    const ctx = { orgId: "org-1", userId: "user-1", feature: "test" };
    await expect(async () => {
      for await (const chunk of callMeteredStreamingChatCompletion(ctx, { messages: [] }, streamFn)) {
        void chunk;
      }
    }).rejects.toThrow(InsufficientCreditsError);
    expect(streamFn).not.toHaveBeenCalled();
  });
});
