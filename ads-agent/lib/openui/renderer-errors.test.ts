import { describe, expect, it } from "vitest";
import { openUiRenderErrorMessage } from "./renderer-errors";

describe("openUiRenderErrorMessage", () => {
  it("returns null when OpenUI clears errors with []", () => {
    expect(openUiRenderErrorMessage([])).toBeNull();
  });

  it("returns null for excess-args only (still renders)", () => {
    expect(
      openUiRenderErrorMessage([
        { code: "excess-args", message: "OpportunityCard takes 6 arg(s), got 8" },
      ]),
    ).toBeNull();
  });

  it("surfaces blocking errors", () => {
    expect(
      openUiRenderErrorMessage([
        {
          code: "inline-reserved",
          message: "Query() must be declared as a top-level statement, not used inline as a value",
        },
      ]),
    ).toBe("Query() must be declared as a top-level statement, not used inline as a value");
  });
});
