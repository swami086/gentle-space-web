import { describe, expect, it, vi } from "vitest";
import { parseWithBoundedRetry, type ParseAttempt } from "./parse-retry";

function fakeParse(text: string): ParseAttempt<string> {
  return text === "valid" ? { kind: "ok", value: text } : { kind: "error", errors: [`bad text: "${text}"`] };
}

describe("parseWithBoundedRetry", () => {
  it("returns ok immediately without calling retryModel when the first parse succeeds", async () => {
    const retryModel = vi.fn();
    const result = await parseWithBoundedRetry("valid", fakeParse, retryModel);
    expect(result).toEqual({ kind: "ok", value: "valid" });
    expect(retryModel).not.toHaveBeenCalled();
  });

  it("retries exactly once with the specific errors, and succeeds if the retry parses", async () => {
    const retryModel = vi.fn().mockResolvedValue("valid");
    const result = await parseWithBoundedRetry("garbled", fakeParse, retryModel);
    expect(result).toEqual({ kind: "ok", value: "valid" });
    expect(retryModel).toHaveBeenCalledTimes(1);
    expect(retryModel.mock.calls[0][0]).toContain('bad text: "garbled"');
  });

  it("gives up after one failed retry — never loops, returns the second failure's errors", async () => {
    const retryModel = vi.fn().mockResolvedValue("still garbled");
    const result = await parseWithBoundedRetry("garbled", fakeParse, retryModel);
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.errors[0]).toContain('bad text: "still garbled"');
    expect(retryModel).toHaveBeenCalledTimes(1);
  });

  it("propagates an exception thrown by retryModel (e.g. InsufficientCreditsError) rather than swallowing it", async () => {
    class FakeCreditsError extends Error {}
    const retryModel = vi.fn().mockRejectedValue(new FakeCreditsError("out of credits"));
    await expect(parseWithBoundedRetry("garbled", fakeParse, retryModel)).rejects.toThrow(FakeCreditsError);
  });
});
