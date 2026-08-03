// lib/leads/qualify-prompt.test.ts
import { describe, expect, it } from "vitest";
import { buildQualifyUserText, parseQualificationJson } from "./qualify-prompt";

describe("buildQualifyUserText", () => {
  it("folds need-specific answers and notes, never a name or phone key", () => {
    const text = buildQualifyUserText({
      need: "office",
      step2Answers: { teamSize: "15 desks" },
      notes: "Need by month end",
    });
    expect(text).toContain("Team size / desks: 15 desks");
    expect(text).toContain("Need by month end");
    expect(text).not.toMatch(/"name"|"phone"/i);
  });
});

describe("parseQualificationJson", () => {
  it("parses a valid response", () => {
    const result = parseQualificationJson('{"tier":"hot","cheatSheet":"Ask about move-in date."}');
    expect(result).toEqual({ tier: "hot", cheatSheet: "Ask about move-in date." });
  });

  it("falls back to unscored on invalid tier", () => {
    const result = parseQualificationJson('{"tier":"urgent","cheatSheet":"x"}');
    expect(result).toEqual({ tier: "unscored", cheatSheet: "" });
  });

  it("falls back to unscored on malformed JSON", () => {
    expect(parseQualificationJson("not json")).toEqual({ tier: "unscored", cheatSheet: "" });
  });
});
