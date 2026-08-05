import { describe, expect, it } from "vitest";
import { campaignLibrary, parseSetupCardResponse, buildCampaignPromptOptions, SetupCardView, DEFAULT_FINAL_URL } from "./campaign-library";

describe("campaignLibrary", () => {
  it("has SetupCard as its root component", () => {
    expect(campaignLibrary.root).toBe("SetupCard");
    expect(Object.keys(campaignLibrary.components)).toEqual(["SetupCard"]);
  });

  it("generates a non-empty system prompt", () => {
    const prompt = campaignLibrary.prompt({ preamble: "test preamble" });
    expect(prompt).toContain("SetupCard");
    expect(prompt).toContain("test preamble");
  });
});

describe("SetupCardView", () => {
  it("does not throw when OpenUI streaming passes null array props", () => {
    expect(() =>
      SetupCardView({
        assistantReply: "Got Whitefield",
        status: "chatting",
        corridor: "Whitefield",
        dailyBudgetInr: 500,
        adGroupName: null,
        keywords: null,
        headlines: null,
        descriptions: null,
        finalUrl: null,
      }),
    ).not.toThrow();

    const tree = SetupCardView({
      assistantReply: "hi",
      status: "chatting",
      headlines: null,
      keywords: null,
      descriptions: null,
    });
    expect(tree).toBeTruthy();
    expect(DEFAULT_FINAL_URL).toContain("gentlespacesolutions");
  });
});

describe("parseSetupCardResponse", () => {
  it("parses a well-formed SetupCard statement", () => {
    const text = `root = SetupCard("Got it, set the corridor.", "chatting", "whitefield", 500, "", [], [], [], "https://www.gentlespacesolutions.com/spaces")`;
    const result = parseSetupCardResponse(text);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.props.assistantReply).toBe("Got it, set the corridor.");
      expect(result.props.corridor).toBe("whitefield");
      expect(result.props.dailyBudgetInr).toBe(500);
    }
  });

  it("returns a parse_error for text with no SetupCard root", () => {
    const result = parseSetupCardResponse("not openui lang at all");
    expect(result.kind).toBe("parse_error");
  });

  it("returns a parse_error when a required prop is missing", () => {
    const text = `root = SetupCard("reply only")`;
    const result = parseSetupCardResponse(text);
    expect(result.kind).toBe("parse_error");
  });

  it("includes PromptOptions examples when building the campaign prompt", () => {
    const prompt = campaignLibrary.prompt(
      buildCampaignPromptOptions("test preamble for campaign drafting"),
    );
    expect(prompt).toContain("test preamble for campaign drafting");
    expect(prompt).toContain("## Examples");
    expect(prompt).toContain('SetupCard("Got Whitefield');
    expect(prompt).toContain("POSITIONAL only");
  });
});
