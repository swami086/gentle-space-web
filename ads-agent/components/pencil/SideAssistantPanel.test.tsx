// ads-agent/components/pencil/SideAssistantPanel.test.tsx
import { describe, expect, it } from "vitest";
import { SideAssistantPanel } from "./SideAssistantPanel";

describe("SideAssistantPanel", () => {
  it("renders the title and every message's content", () => {
    const el = SideAssistantPanel({
      title: "Campaign Chat",
      messages: [
        { id: "1", role: "user", content: "Show me hot leads" },
        { id: "2", role: "assistant", content: "Here they are" },
      ],
      input: "",
      onInputChange: () => {},
      onSend: () => {},
      sending: false,
    });
    const json = JSON.stringify(el);
    expect(json).toContain("Campaign Chat");
    expect(json).toContain("Show me hot leads");
    expect(json).toContain("Here they are");
  });

  it("renders the pinnedActionSlot above the input when provided", () => {
    const el = SideAssistantPanel({
      title: "CRM Assistant",
      messages: [],
      input: "",
      onInputChange: () => {},
      onSend: () => {},
      sending: false,
      pinnedActionSlot: "CONFIRM ACTION",
    });
    expect(JSON.stringify(el)).toContain("CONFIRM ACTION");
  });

  it("does not throw with an empty message list", () => {
    expect(() =>
      SideAssistantPanel({ title: "Empty", messages: [], input: "", onInputChange: () => {}, onSend: () => {}, sending: false }),
    ).not.toThrow();
  });
});
