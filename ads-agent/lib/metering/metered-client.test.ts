import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatCompletion, getOrgBalance, getUserCap, debitUsage } = vi.hoisted(() => ({
  chatCompletion: vi.fn(),
  getOrgBalance: vi.fn(),
  getUserCap: vi.fn(),
  debitUsage: vi.fn(),
}));

vi.mock("../bifrost/client", () => ({ chatCompletion }));
vi.mock("./ledger", () => ({ getOrgBalance, getUserCap, debitUsage }));

import { callMeteredChatCompletion } from "./metered-client";
import { InsufficientCreditsError } from "./types";

const ctx = { orgId: "org-1", userId: "user-1", feature: "ads-agent:campaign-chat" };

beforeEach(() => {
  chatCompletion.mockReset();
  getOrgBalance.mockReset();
  getUserCap.mockReset();
  debitUsage.mockReset();
  getOrgBalance.mockResolvedValue(100);
  getUserCap.mockResolvedValue(null);
  debitUsage.mockResolvedValue(undefined);
});

describe("callMeteredChatCompletion", () => {
  it("throws InsufficientCreditsError before calling Bifrost when the org balance is <= 0", async () => {
    getOrgBalance.mockResolvedValue(0);
    await expect(
      callMeteredChatCompletion(ctx, { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(InsufficientCreditsError);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("throws InsufficientCreditsError before calling Bifrost when the user's individual cap is <= 0", async () => {
    getUserCap.mockResolvedValue(0);
    await expect(
      callMeteredChatCompletion(ctx, { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(InsufficientCreditsError);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("calls Bifrost and debits the correct credits from a real usage response", async () => {
    chatCompletion.mockResolvedValue({
      id: "req-123",
      model: "gemini-2.5-flash-lite",
      choices: [{ message: { role: "assistant", content: "hello" } }],
      usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 },
    });

    const response = await callMeteredChatCompletion(ctx, {
      model: "vertex/gemini-2.5-flash-lite",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(response.choices?.[0]?.message?.content).toBe("hello");
    expect(debitUsage).toHaveBeenCalledTimes(1);
    const debitArgs = debitUsage.mock.calls[0][0];
    expect(debitArgs).toMatchObject({
      orgId: "org-1",
      userId: "user-1",
      feature: "ads-agent:campaign-chat",
      provider: "vertex",
      promptTokens: 1000,
      completionTokens: 1000,
      totalTokens: 2000,
      requestId: "req-123",
    });
    expect(debitArgs.costUsd).toBeCloseTo(0.0001 + 0.0004, 6);
    expect(debitArgs.creditsDebited).toBeCloseTo((0.0001 + 0.0004) * 100, 6);
  });

  it("debits 0 credits for an unlisted model instead of throwing", async () => {
    chatCompletion.mockResolvedValue({
      choices: [{ message: { content: "hi" } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
    await callMeteredChatCompletion(ctx, { model: "vertex/some-future-model", messages: [] });
    expect(debitUsage.mock.calls[0][0].costUsd).toBe(0);
    expect(debitUsage.mock.calls[0][0].creditsDebited).toBe(0);
  });
});

it("assertSufficientCredits throws InsufficientCreditsError when org balance is zero", async () => {
  getOrgBalance.mockResolvedValue(0);
  const { assertSufficientCredits } = await import("./metered-client");
  await expect(
    assertSufficientCredits({ orgId: "org-1", userId: "user-1", feature: "test" }),
  ).rejects.toThrow(InsufficientCreditsError);
});

it("assertSufficientCredits resolves when balance and cap are both sufficient", async () => {
  getOrgBalance.mockResolvedValue(100);
  getUserCap.mockResolvedValue(50);
  const { assertSufficientCredits } = await import("./metered-client");
  await expect(
    assertSufficientCredits({ orgId: "org-1", userId: "user-1", feature: "test" }),
  ).resolves.toBeUndefined();
});
