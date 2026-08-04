import { describe, expect, it } from "vitest";
import {
  DEFAULT_FINAL_URL,
  normalizeSetupCardLang,
  splitTopLevelArgs,
} from "./normalize-setup-card";
import { parseSetupCardResponse } from "./campaign-library";

describe("splitTopLevelArgs", () => {
  it("keeps commas inside strings", () => {
    expect(splitTopLevelArgs('"a, b", "chatting", 500')).toEqual(['"a, b"', '"chatting"', "500"]);
  });

  it("keeps commas inside arrays", () => {
    expect(splitTopLevelArgs('"hi", ["a", "b"], []')).toEqual(['"hi"', '["a", "b"]', "[]"]);
  });
});

describe("normalizeSetupCardLang", () => {
  it("rewrites named kwargs to positional OpenUI Lang", () => {
    const input =
      'root = SetupCard(assistantReply="Okay, Whitefield at ₹500", status="chatting", corridor="Whitefield", dailyBudgetInr=500)';
    const out = normalizeSetupCardLang(input);
    expect(out).toContain('SetupCard("Okay, Whitefield at ₹500", "chatting", "Whitefield", 500');
    expect(out).not.toContain("assistantReply=");
    expect(out).toContain(JSON.stringify(DEFAULT_FINAL_URL));
  });

  it("leaves positional calls unchanged", () => {
    const input = `root = SetupCard("hi", "chatting", "Whitefield", 500)`;
    expect(normalizeSetupCardLang(input)).toBe(input);
  });

  it("rewrites colon-style named args", () => {
    const input = 'root = SetupCard(assistantReply: "hi", status: "chatting")';
    const out = normalizeSetupCardLang(input);
    expect(out).toContain('SetupCard("hi", "chatting"');
    expect(out).not.toContain("assistantReply:");
  });
});

describe("parseSetupCardResponse named + partial", () => {
  it("parses Gemini-style named kwargs after normalize", () => {
    const text =
      'root = SetupCard(assistantReply="Okay, let\'s get your campaign started! We\'ll focus on Whitefield with a ₹500 daily budget. What\'s the main goal?", status="chatting", corridor="Whitefield", dailyBudgetInr=500)';
    const result = parseSetupCardResponse(text);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.props.corridor).toBe("Whitefield");
      expect(result.props.dailyBudgetInr).toBe(500);
      expect(result.props.finalUrl).toBe(DEFAULT_FINAL_URL);
      expect(result.props.assistantReply).toContain("Whitefield");
    }
  });

  it("parses trailing-omitted positional args via schema defaults", () => {
    const result = parseSetupCardResponse(`root = SetupCard("Which corridor?", "chatting")`);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.props.corridor).toBe("");
      expect(result.props.dailyBudgetInr).toBe(0);
      expect(result.props.finalUrl).toBe(DEFAULT_FINAL_URL);
    }
  });
});
