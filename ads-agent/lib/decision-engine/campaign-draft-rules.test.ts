import { describe, expect, it } from "vitest";
import type { CampaignDraft } from "../types";
import { isDraftReady, validateDraftFields } from "./campaign-draft-rules";

function draft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    id: "draft-1",
    status: "chatting",
    corridor: "whitefield",
    dailyBudgetInr: 500,
    adGroupName: "Whitefield Office Space",
    keywords: [{ text: "office space whitefield", matchType: "phrase" }],
    headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
    descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
    finalUrl: "https://www.gentlespacesolutions.com/spaces",
    proposalId: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

describe("validateDraftFields", () => {
  it("returns no errors for a clean patch", () => {
    expect(validateDraftFields({ headlines: ["Short headline"], descriptions: ["Short description"] })).toEqual([]);
  });

  it("flags a headline over 30 characters", () => {
    const errors = validateDraftFields({ headlines: ["This headline is deliberately far too long for RSA"] });
    expect(errors).toEqual(["headlines[0] \"This headline is deliberately far too long for RSA\" exceeds 30 characters"]);
  });

  it("flags more than 15 headlines", () => {
    const errors = validateDraftFields({ headlines: Array.from({ length: 16 }, (_, i) => `H${i}`) });
    expect(errors).toEqual(["headlines: at most 15 allowed, got 16"]);
  });

  it("flags a description over 90 characters", () => {
    const longDescription = "x".repeat(91);
    const errors = validateDraftFields({ descriptions: [longDescription] });
    expect(errors).toEqual([`descriptions[0] "${longDescription}" exceeds 90 characters`]);
  });

  it("flags more than 4 descriptions", () => {
    const errors = validateDraftFields({ descriptions: ["a", "b", "c", "d", "e"] });
    expect(errors).toEqual(["descriptions: at most 4 allowed, got 5"]);
  });

  it("flags a non-positive daily budget", () => {
    expect(validateDraftFields({ dailyBudgetInr: 0 })).toEqual(["dailyBudgetInr must be greater than 0"]);
    expect(validateDraftFields({ dailyBudgetInr: -50 })).toEqual(["dailyBudgetInr must be greater than 0"]);
  });

  it("ignores fields that are not present in the patch", () => {
    expect(validateDraftFields({ corridor: "koramangala" })).toEqual([]);
  });

  it("flags a blank headline", () => {
    expect(validateDraftFields({ headlines: ["Valid", "   ", "Also valid"] })).toEqual(["headlines[1] must not be blank"]);
  });

  it("flags a blank description", () => {
    expect(validateDraftFields({ descriptions: ["Valid", ""] })).toEqual(["descriptions[1] must not be blank"]);
  });

  it("flags a keyword with empty text", () => {
    expect(validateDraftFields({ keywords: [{ text: "office space", matchType: "phrase" }, { text: "  ", matchType: "exact" }] })).toEqual([
      "keywords[1].text must not be blank",
    ]);
  });
});

describe("isDraftReady", () => {
  it("is true for a complete, valid draft", () => {
    expect(isDraftReady(draft())).toBe(true);
  });

  it("is false when corridor is missing", () => {
    expect(isDraftReady(draft({ corridor: null }))).toBe(false);
  });

  it("is false when there are no keywords yet", () => {
    expect(isDraftReady(draft({ keywords: [] }))).toBe(false);
  });

  it("is false with fewer than 3 headlines", () => {
    expect(isDraftReady(draft({ headlines: ["Only one"] }))).toBe(false);
  });

  it("is false with fewer than 2 descriptions", () => {
    expect(isDraftReady(draft({ descriptions: ["Only one"] }))).toBe(false);
  });

  it("is false when a headline exceeds the character limit even if counts are right", () => {
    expect(isDraftReady(draft({ headlines: ["ok", "ok", "This one headline is far too long for RSA rules"] }))).toBe(false);
  });

  it("is false when corridor is whitespace-only", () => {
    expect(isDraftReady(draft({ corridor: "   " }))).toBe(false);
  });

  it("is false when adGroupName is whitespace-only", () => {
    expect(isDraftReady(draft({ adGroupName: "  " }))).toBe(false);
  });

  it("is false when a headline is blank", () => {
    expect(isDraftReady(draft({ headlines: ["Valid", "   ", "Also valid"] }))).toBe(false);
  });

  it("is false when a description is blank", () => {
    expect(isDraftReady(draft({ descriptions: ["Valid", ""] }))).toBe(false);
  });

  it("is false when a keyword text is blank", () => {
    expect(isDraftReady(draft({ keywords: [{ text: "office space", matchType: "phrase" }, { text: "  ", matchType: "exact" }] }))).toBe(false);
  });
});
