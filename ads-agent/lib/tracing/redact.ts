/**
 * Spans carry structure; content is referenced where it already lives
 * (datastore §13.3, dataflow review A-3). "No message bodies" is a negative
 * assertion, so it needs enforcement at every place a body can arrive:
 * a named attribute, a long value under an innocuous key, and an exception
 * message — which is where this normally breaks.
 */
export const FORBIDDEN_SPAN_ATTRIBUTES = [
  "gen_ai.input.messages",
  "gen_ai.output.messages",
  "gen_ai.prompt",
  "gen_ai.completion",
  "gen_ai.content.prompt",
  "gen_ai.content.completion",
] as const;

export const MAX_SPAN_ATTRIBUTE_CHARS = 256;

export type SpanRedactionErrorCode = "span_attribute_forbidden" | "span_attribute_too_long";

export class SpanRedactionError extends Error {
  constructor(readonly code: SpanRedactionErrorCode, attributeKey: string) {
    super(`${code}: ${attributeKey}`);
    this.name = "SpanRedactionError";
  }
}

export function assertNoMessageBodies(
  attributes: Record<string, string | number | boolean>,
): void {
  for (const [key, value] of Object.entries(attributes)) {
    if ((FORBIDDEN_SPAN_ATTRIBUTES as readonly string[]).includes(key)) {
      throw new SpanRedactionError("span_attribute_forbidden", key);
    }
    if (typeof value === "string" && value.length > MAX_SPAN_ATTRIBUTE_CHARS) {
      // The message names the key, never the value.
      throw new SpanRedactionError("span_attribute_too_long", key);
    }
  }
}

const CODE_PATTERN = /^[a-z][a-z0-9_]{2,39}$/;

/**
 * The only permitted way to put a failure on a span. `err.message` is never
 * used: a Postgres error's message and detail echo row values, a ClickHouse
 * error echoes the query, and a validation error echoes the input.
 */
export function safeErrorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && CODE_PATTERN.test(code) ? code : "tool_error";
}
