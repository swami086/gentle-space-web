import { describe, expect, it } from "vitest";
import type { ActionEvent } from "@openuidev/lang-core";
import { BuiltinActionType } from "@openuidev/lang-core";
import { hermesLibrary, looksValidOpenUiLang, resolveOpenUiAction, stripHermesStepNarration } from "./hermes-library";

describe("hermesLibrary", () => {
  it("includes the chat library's own root plus every CRM and analytics domain component", () => {
    const names = Object.keys(hermesLibrary.components);
    expect(names).toEqual(
      expect.arrayContaining([
        "Card",
        "TextContent",
        "Callout",
        "OpportunityCard",
        "OpportunityList",
        "StageChangeConfirm",
        "TrendChart",
        "DataTable",
      ]),
    );
  });

  it("has no duplicate component names across the merged libraries", () => {
    const names = Object.keys(hermesLibrary.components);
    expect(new Set(names).size).toBe(names.length);
  });

  it("generates a non-empty prompt that mentions the domain components", () => {
    const prompt = hermesLibrary.prompt({ toolCalls: false, bindings: false });
    expect(prompt).toContain("OpportunityCard");
    expect(prompt).toContain("TrendChart");
  });
});

describe("looksValidOpenUiLang", () => {
  it("accepts a valid domain component call with resolved static data", () => {
    const response =
      'root = OpportunityList([{name: "Priya Sharma", stage: "SHORTLIST", tier: "HOT", amountLabel: "", maskedPhone: "", source: ""}])';
    expect(looksValidOpenUiLang(response, hermesLibrary)).toBe(true);
  });

  it("accepts a valid chat-library component call", () => {
    expect(looksValidOpenUiLang('root = TextContent("Got it — I\'ll keep an eye on that.")', hermesLibrary)).toBe(true);
  });

  it("rejects an unknown component name", () => {
    expect(looksValidOpenUiLang('root = TotallyMadeUpComponent("x")', hermesLibrary)).toBe(false);
  });

  it("rejects plain prose with no parseable root", () => {
    expect(looksValidOpenUiLang("Sure, here's a summary of your leads.", hermesLibrary)).toBe(false);
  });
});

describe("stripHermesStepNarration", () => {
  it("keeps only the text after the last bolded step header", () => {
    const raw =
      "**Finding Ad Spend Data** Looking for tools. **Gathering Ad Spend Data** Retrieved it. " +
      "**Confirming No Spend Data** No spend data is available for the past seven days.";
    expect(stripHermesStepNarration(raw)).toBe("No spend data is available for the past seven days.");
  });

  it("returns the original text unchanged when there is no step header", () => {
    const reply = 'root = TextContent("Got it — I\'ll keep an eye on that.")';
    expect(stripHermesStepNarration(reply)).toBe(reply);
  });

  it("falls back to the full text when the last header has no trailing content", () => {
    const raw = "**Wrapping Up**";
    expect(stripHermesStepNarration(raw)).toBe(raw);
  });

  it("matches a full-sentence header, not just a short noun phrase, and also strips prose left before root=", () => {
    const raw =
      "I've examined the tool and confirmed it's the right one for this task. " +
      "**Next, I'll execute the tool and render the resulting data in a chart for your review.** " +
      'This will provide a clear visualization. root = TrendChart("Ad Spend Last 7 Days", points=[])';
    expect(stripHermesStepNarration(raw)).toBe('root = TrendChart("Ad Spend Last 7 Days", [])');
  });

  it("strips plain-prose narration (no bold header at all) ahead of a bare root= statement", () => {
    const raw =
      "I've successfully parsed the JSON string. Now, I am transforming the date and spend data into " +
      'the required format for the `TrendChart` component. root = TrendChart("Ad Spend Trend - Last 7 Days", ' +
      '[{label: "Aug 04", value: 2704}])';
    expect(stripHermesStepNarration(raw)).toBe(
      'root = TrendChart("Ad Spend Trend - Last 7 Days", [{label: "Aug 04", value: 2704}])',
    );
  });

  it("converts a named kwarg call argument to positional so the strict parser accepts it", () => {
    const raw =
      'root = TrendChart("Ad Spend Trend — Last 7 Days", points=[{"label": "Aug 04", "value": 2704}])';
    const result = stripHermesStepNarration(raw);
    expect(result).toBe('root = TrendChart("Ad Spend Trend — Last 7 Days", [{"label": "Aug 04", "value": 2704}])');
    expect(looksValidOpenUiLang(result, hermesLibrary)).toBe(true);
  });

  it("leaves top-level $var assignments untouched (never preceded by '(' or ',') while still fixing kwargs in calls", () => {
    // OpenUI's own recommended style puts `root = ...` first, then supporting declarations below it —
    // so the root-stripping pass is a no-op here (root is already at index 0) and only the kwarg fix runs.
    const raw = 'root = Stack([chart])\nchart = TrendChart(title="Spend", points=[])\n$days = "7"';
    expect(stripHermesStepNarration(raw)).toBe('root = Stack([chart])\nchart = TrendChart("Spend", [])\n$days = "7"');
  });
});

describe("resolveOpenUiAction", () => {
  it("sends the clicked text as a new message for a continue_conversation action", () => {
    const event: ActionEvent = {
      type: BuiltinActionType.ContinueConversation,
      params: {},
      humanFriendlyMessage: "Tell me more about this lead",
    };
    expect(resolveOpenUiAction(event)).toEqual({ kind: "send", text: "Tell me more about this lead" });
  });

  it("opens the URL for an open_url action", () => {
    const event: ActionEvent = {
      type: BuiltinActionType.OpenUrl,
      params: { url: "https://example.com/report" },
      humanFriendlyMessage: "",
    };
    expect(resolveOpenUiAction(event)).toEqual({ kind: "open_url", url: "https://example.com/report" });
  });

  it("no-ops when humanFriendlyMessage is empty or whitespace-only", () => {
    const event: ActionEvent = { type: BuiltinActionType.ContinueConversation, params: {}, humanFriendlyMessage: "   " };
    expect(resolveOpenUiAction(event)).toEqual({ kind: "noop" });
  });

  it("still sends for an unrecognized custom action type as long as a message is present", () => {
    const event: ActionEvent = { type: "some_custom_action", params: {}, humanFriendlyMessage: "Do the thing" };
    expect(resolveOpenUiAction(event)).toEqual({ kind: "send", text: "Do the thing" });
  });
});
