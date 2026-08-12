import { describe, expect, it } from "vitest";
import { assertNoMessageBodies, MAX_SPAN_ATTRIBUTE_CHARS, safeErrorCode, SpanRedactionError } from "./redact";

const BODY =
  "Hi, we're looking for 40 desks in Whitefield from October. Reach me on asha@example.com or 98450 12345.";

describe("assertNoMessageBodies", () => {
  it("accepts structure and references", () => {
    expect(() =>
      assertNoMessageBodies({
        "gen_ai.tool.name": "get_enquiry",
        "gen_ai.agent.name": "leads",
        "gentlespace.tenant.id": "11111111-1111-1111-1111-111111111111",
        "gentlespace.enquiry.row_id": "33333333-3333-3333-3333-333333333333",
        "gen_ai.client.token.usage": 120,
        "gentlespace.cdc.lag_seconds": 12,
      }),
    ).not.toThrow();
  });

  it.each([
    "gen_ai.input.messages",
    "gen_ai.output.messages",
    "gen_ai.prompt",
    "gen_ai.completion",
    "gen_ai.content.prompt",
    "gen_ai.content.completion",
  ])("rejects the forbidden attribute %s", (key) => {
    expect(() => assertNoMessageBodies({ [key]: "anything" })).toThrow(SpanRedactionError);
  });

  it("rejects a body smuggled under an innocuous key, by length", () => {
    expect(() => assertNoMessageBodies({ "gentlespace.note": BODY.repeat(4) })).toThrow(
      /span_attribute_too_long/,
    );
  });

  it("caps at 256 characters, so a summary is fine and a transcript is not", () => {
    expect(() => assertNoMessageBodies({ x: "a".repeat(MAX_SPAN_ATTRIBUTE_CHARS) })).not.toThrow();
    expect(() => assertNoMessageBodies({ x: "a".repeat(MAX_SPAN_ATTRIBUTE_CHARS + 1) })).toThrow();
  });
});

describe("safeErrorCode", () => {
  it("returns the error's own code when it is a stable identifier", () => {
    expect(safeErrorCode(Object.assign(new Error("x"), { code: "token_invalid" }))).toBe("token_invalid");
  });

  it("never returns the exception message, which is where a body normally leaks", () => {
    const code = safeErrorCode(new Error(BODY));
    expect(code).toBe("tool_error");
    expect(code).not.toContain("asha@example.com");
  });

  it("does not trust a code that is itself prose", () => {
    expect(safeErrorCode(Object.assign(new Error("x"), { code: BODY }))).toBe("tool_error");
  });

  it("handles a thrown non-Error without reflecting it", () => {
    expect(safeErrorCode({ detail: BODY })).toBe("tool_error");
    expect(safeErrorCode(BODY)).toBe("tool_error");
    expect(safeErrorCode(undefined)).toBe("tool_error");
  });

  it("does not leak through a PostgreSQL error, whose detail can echo a row", () => {
    const pgError = Object.assign(new Error(`duplicate key value violates unique constraint`), {
      code: "23505",
      detail: `Key (contact_email)=(${"asha@example.com"}) already exists.`,
    });
    const code = safeErrorCode(pgError);
    expect(code).toBe("tool_error");
    expect(JSON.stringify({ code })).not.toContain("asha@example.com");
  });
});
