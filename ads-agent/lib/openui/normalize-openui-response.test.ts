import { describe, expect, it } from "vitest";
import { createParser } from "@openuidev/lang-core";
import { platformLibrary } from "./platform-library";
import { ensureOpenUiRootAssignment, normalizeOpenUiResponse } from "./normalize-openui-response";
import { looksLikeOpenUiLang } from "./is-openui-lang";

describe("ensureOpenUiRootAssignment", () => {
  it("prepends root = for bare ComponentName calls", () => {
    expect(ensureOpenUiRootAssignment('SetupCard("hi", "chatting")')).toBe('root = SetupCard("hi", "chatting")');
  });

  it("leaves existing root = statements alone", () => {
    expect(ensureOpenUiRootAssignment('root = StatCard("Leads", "42")')).toBe('root = StatCard("Leads", "42")');
  });
});

describe("normalizeOpenUiResponse", () => {
  it("coerces bare named-arg SetupCard into a parseable root statement", () => {
    const raw =
      'SetupCard(assistantReply: "Let\'s get your campaign set up!", status: "ready", corridor: "Whitefield", dailyBudgetInr: 1000, adGroupName: "Sample", keywords: [], headlines: ["H1"], descriptions: ["D1"], finalUrl: "https://example.com")';
    const normalized = normalizeOpenUiResponse(raw);
    expect(looksLikeOpenUiLang(normalized)).toBe(true);
    const result = createParser(platformLibrary.toJSONSchema()).parse(normalized);
    expect(result.root).toBeTruthy();
    expect((result.root as { typeName: string }).typeName).toBe("SetupCard");
    expect(result.meta.errors).toEqual([]);
  });
});
