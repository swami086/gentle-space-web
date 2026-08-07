import { describe, expect, it } from "vitest";
import { looksLikeOpenUiLang } from "./is-openui-lang";

describe("looksLikeOpenUiLang", () => {
  it("returns true for a root component statement", () => {
    expect(looksLikeOpenUiLang('root = StatCard("Leads", "42")')).toBe(true);
  });

  it("returns true when whitespace surrounds the statement", () => {
    expect(looksLikeOpenUiLang('  root = CampaignList([])  ')).toBe(true);
  });

  it("returns true for bare ComponentName( calls without root =", () => {
    expect(looksLikeOpenUiLang('SetupCard("hi", "chatting")')).toBe(true);
  });

  it("returns true for official Query→component multi-statement programs", () => {
    expect(
      looksLikeOpenUiLang(
        'opps = Query("list_opportunities", {}, [])\nroot = OpportunityList(opps)',
      ),
    ).toBe(true);
  });

  it("returns false for short plain-text acknowledgments", () => {
    expect(looksLikeOpenUiLang("Done — paused that campaign.")).toBe(false);
  });

  it("returns false for fallback/error prose without a root statement", () => {
    expect(looksLikeOpenUiLang("I had trouble putting that together — could you rephrase?")).toBe(false);
  });

  it("returns false for partial OpenUI before the opening paren", () => {
    expect(looksLikeOpenUiLang("root = StatCard")).toBe(false);
  });

  it("returns false for empty or whitespace-only input", () => {
    expect(looksLikeOpenUiLang("")).toBe(false);
    expect(looksLikeOpenUiLang("   ")).toBe(false);
  });
});
