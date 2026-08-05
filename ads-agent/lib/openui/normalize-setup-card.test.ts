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

  it("rewrites leading positionals + trailing named kwargs (headlines turn)", () => {
    const input =
      'root = SetupCard("Here are headlines and descriptions.", "chatting", headlines=["Office Space Whitefield","Find Office Near You","Bangalore CRE Experts"], descriptions=["Find verified office space in Whitefield.","Trusted CRE consultancy for Bangalore teams."])';
    const out = normalizeSetupCardLang(input);
    expect(out).not.toContain("headlines=");
    expect(out).toContain('["Office Space Whitefield"');
    expect(out).toContain('["Find verified office space');
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

  it("parses bare SetupCard without root = (propose headlines path)", () => {
    const text =
      'SetupCard("Proposed copy.", "chatting", "", 0, "", [], ["Office Space Whitefield","Find Office Near You","Bangalore CRE Experts"], ["Find verified office space in Whitefield.","Trusted CRE for Bangalore teams."])';
    const result = parseSetupCardResponse(text);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.props.headlines).toHaveLength(3);
      expect(result.props.descriptions).toHaveLength(2);
    }
  });

  it("parses mixed positional + named headlines/descriptions", () => {
    const text =
      'root = SetupCard("Here are headlines and descriptions.", "chatting", headlines=["Office Space Whitefield","Find Office Near You","Bangalore CRE Experts"], descriptions=["Find verified office space in Whitefield.","Trusted CRE consultancy for Bangalore teams."])';
    const result = parseSetupCardResponse(text);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.props.headlines).toEqual([
        "Office Space Whitefield",
        "Find Office Near You",
        "Bangalore CRE Experts",
      ]);
      expect(result.props.descriptions).toHaveLength(2);
    }
  });

  it("parses SetupCard after a short prose preamble", () => {
    const text =
      'Sure — here you go!\nSetupCard("Proposed copy.", "chatting", "", 0, "", [], ["H1","H2","H3"], ["D1 is under ninety characters for RSA.","D2 keeps the corridor clear."])';
    const result = parseSetupCardResponse(text);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.props.headlines).toEqual(["H1", "H2", "H3"]);
    }
  });
});
