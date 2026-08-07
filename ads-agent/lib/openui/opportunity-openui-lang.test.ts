import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../bifrost/client";
import {
  formatOpportunityCardLang,
  formatOpportunityListLang,
  latestOpportunityToolPayload,
  openUiReplyFromOpportunityTools,
} from "./opportunity-openui-lang";
import { normalizeOpenUiResponse } from "./normalize-openui-response";
import { normalizeNamedKwargsLang } from "./normalize-named-kwargs";

const card = {
  name: "API Integration Deal",
  stage: "NEW_BRIEF",
  tier: "UNSCORED" as const,
  amountLabel: "₹75,000",
  maskedPhone: "",
  source: "",
};

describe("formatOpportunityListLang / formatOpportunityCardLang", () => {
  it("emits OpportunityList with OpenUI object literals (not JSON keys)", () => {
    const lang = formatOpportunityListLang([card]);
    expect(lang).toBe(
      'root = OpportunityList([{name: "API Integration Deal", stage: "NEW_BRIEF", tier: "UNSCORED", amountLabel: "₹75,000", maskedPhone: "", source: ""}])',
    );
  });

  it("emits empty OpportunityList", () => {
    expect(formatOpportunityListLang([])).toBe("root = OpportunityList([])");
  });

  it("emits OpportunityCard with exactly 6 positional string args", () => {
    const lang = formatOpportunityCardLang(card);
    expect(lang).toBe(
      'root = OpportunityCard("API Integration Deal", "NEW_BRIEF", "UNSCORED", "₹75,000", "", "")',
    );
    const inner = lang.slice(lang.indexOf("(") + 1, lang.lastIndexOf(")"));
    expect(inner.split(",").length).toBeGreaterThanOrEqual(6);
  });
});

describe("latestOpportunityToolPayload / openUiReplyFromOpportunityTools", () => {
  const listHistory: ChatMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "list opportunities" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "list_opportunities", arguments: "{}" } },
      ],
    },
    { role: "tool", content: JSON.stringify([card, { ...card, name: "office: Bob Property" }]), tool_call_id: "call_1" },
  ];

  it("extracts reshaped list rows from tool history", () => {
    expect(latestOpportunityToolPayload(listHistory)).toEqual({
      kind: "list",
      rows: [card, { ...card, name: "office: Bob Property" }],
    });
  });

  it("builds OpportunityList OpenUI without calling the model", () => {
    const reply = openUiReplyFromOpportunityTools(listHistory);
    expect(reply).toContain("OpportunityList([");
    expect(reply).toContain("API Integration Deal");
    expect(reply).toContain("office: Bob Property");
    expect(reply).not.toMatch(/OpportunityCard\(/);
  });

  it("extracts a single get_opportunity card", () => {
    const history: ChatMessage[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "c2", type: "function", function: { name: "get_opportunity", arguments: '{"id":"1"}' } },
        ],
      },
      { role: "tool", content: JSON.stringify(card), tool_call_id: "c2" },
    ];
    expect(latestOpportunityToolPayload(history)).toEqual({ kind: "card", row: card });
    expect(openUiReplyFromOpportunityTools(history)).toContain("OpportunityCard(");
  });

  it("returns null when there is no opportunity tool message", () => {
    expect(openUiReplyFromOpportunityTools([{ role: "user", content: "hi" }])).toBeNull();
  });

  it("drops fat rows missing name/stage from list payloads", () => {
    const history: ChatMessage[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "list_opportunities", arguments: "{}" } },
        ],
      },
      { role: "tool", content: JSON.stringify([{ id: "1" }, card]), tool_call_id: "call_1" },
    ];
    expect(latestOpportunityToolPayload(history)).toEqual({ kind: "list", rows: [card] });
  });
});

describe("normalize: Twenty-shaped OpportunityCard excess args", () => {
  it("remaps UUID-first 18-arg OpportunityCard dumps into 6 Zod props", () => {
    const fat =
      'root = OpportunityCard("2beb07b0-340c-41d7-be33-5aa91757f329", "API Integration Deal", ' +
      '{amountMicros: 75000000000, currencyCode: "USD"}, "NEW_BRIEF", "2026-01-25T16:26:00.000Z", ' +
      '"1f70157c-4ea5-4d81-bc49-e1401abfbb94", {id: "1f70157c-4ea5-4d81-bc49-e1401abfbb94", name: "Stripe"}, ' +
      '"edf6d445-13a7-4373-9a47-8f89e8c0a877", {id: "edf6d445-13a7-4373-9a47-8f89e8c0a877", name: {firstName: "Patrick", lastName: "Collison"}}, ' +
      "null, null, null, null, null, null, null, null, null)";
    const out = normalizeOpenUiResponse(fat);
    expect(out).toBe(
      'root = OpportunityCard("API Integration Deal", "NEW_BRIEF", "UNSCORED", "₹75,000", "", "")',
    );
  });

  it("clamps non-UUID excess OpportunityCard args to arity 6 (silence Renderer excess error)", () => {
    const out = normalizeNamedKwargsLang(
      'OpportunityCard("a", "b", "HOT", "1", "2", "3", "extra1", "extra2")',
    );
    expect(out).toBe('OpportunityCard("a", "b", "HOT", "1", "2", "3")');
  });

  it("leaves a correct 6-arg OpportunityCard unchanged", () => {
    const ok = 'root = OpportunityCard("Priya", "SHORTLIST", "HOT", "₹15,000", "+91 8XXXXX-1234", "WhatsApp")';
    expect(normalizeOpenUiResponse(ok)).toBe(ok);
  });
});
