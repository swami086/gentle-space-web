import { describe, expect, it } from "vitest";
import { hermesPromptLibrary } from "./hermes-prompt-library";

describe("hermesPromptLibrary", () => {
  it("includes only the CRM and analytics domain components (no openuiChatLibrary)", () => {
    const names = Object.keys(hermesPromptLibrary.components);
    expect(names.sort()).toEqual(
      ["OpportunityCard", "OpportunityList", "StageChangeConfirm", "TrendChart", "DataTable"].sort(),
    );
  });

  it("generates a non-empty prompt that mentions the domain components", () => {
    const prompt = hermesPromptLibrary.prompt({ toolCalls: false, bindings: false });
    expect(prompt).toContain("OpportunityCard");
    expect(prompt).toContain("TrendChart");
  });
});
