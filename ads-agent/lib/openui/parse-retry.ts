export type ParseAttempt<T> = { kind: "ok"; value: T } | { kind: "error"; errors: string[] };

export type ParseFn<T> = (rawText: string) => ParseAttempt<T>;

/** Sends `feedback` (the specific parse errors + a request to re-emit) as the next user turn and
 * returns the model's raw text reply. Any error it throws (e.g. an insufficient-credits error)
 * propagates to parseWithBoundedRetry's caller unmodified — this helper never swallows it. */
export type RetryModelFn = (feedback: string) => Promise<string>;

/**
 * Bounded retry-on-parse-failure: attempt `parse(firstRawText)`; on failure, call `retryModel()`
 * exactly once with the specific errors, parse that reply, and return it — success or failure —
 * without a second retry. This is the convention mandated by
 * docs/superpowers/specs/2026-08-05-openui-platform-foundation-design.md's Resilience section:
 * never zero retries (a user should never be dead-ended on the first structurally-bad response),
 * and never more than one (unbounded retries risk masking a genuinely broken model call behind
 * repeated latency/cost). `campaign-chat.ts`'s inline implementation is the reference this
 * generalizes — extracted now that a second caller (the Copilot route, Task 12) needs the same
 * mechanic, per the threshold that spec's own Resilience section sets for extraction.
 */
export async function parseWithBoundedRetry<T>(
  firstRawText: string,
  parse: ParseFn<T>,
  retryModel: RetryModelFn,
): Promise<ParseAttempt<T>> {
  const first = parse(firstRawText);
  if (first.kind === "ok") return first;

  const feedback = `That could not be parsed (${first.errors.join("; ") || "unknown parse error"}). Re-emit exactly one valid statement, positional args only — no markdown fences, no prose outside the statement.`;
  const retryRawText = await retryModel(feedback);
  return parse(retryRawText);
}
