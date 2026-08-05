import { describe, expect, it } from "vitest";
import { platformLibrary } from "./platform-library";

describe("platformLibrary", () => {
  it("registers SetupCard plus all nine shared components, exactly once each", () => {
    const names = Object.keys(platformLibrary.components).sort();
    expect(names).toEqual(
      [
        "SetupCard",
        "AlertBanner", "BatchActionConfirm", "ChecklistCard", "ComparisonCard",
        "InsightCallout", "KpiGrid", "RankedList", "StatCard", "Timeline",
      ].sort(),
    );
    expect(names).toHaveLength(10);
  });

  it("has no fixed root — the global Copilot may render any composed component as the turn's root", () => {
    expect(platformLibrary.root).toBeUndefined();
  });

  it("generates a non-empty system prompt mentioning SetupCard and a shared component", () => {
    const prompt = platformLibrary.prompt({ preamble: "test" });
    expect(prompt).toContain("SetupCard");
    expect(prompt).toContain("KpiGrid");
  });
});
