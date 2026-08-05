import { describe, expect, it } from "vitest";
import { platformLibrary } from "./platform-library";

describe("platformLibrary", () => {
  it("registers SetupCard plus all nine shared components, exactly once each", () => {
    const names = Object.keys(platformLibrary.components).sort();
    expect(names).toEqual(
      [
        "SetupCard",
        "OpportunityCard", "OpportunityList", "StageChangeConfirm",
        "TrendChart", "DataTable",
        "AlertBanner", "BatchActionConfirm", "ChecklistCard", "ComparisonCard",
        "InsightCallout", "KpiGrid", "RankedList", "StatCard", "Timeline",
      ].sort(),
    );
    expect(names).toHaveLength(15);
  });

  it("has no fixed root — the global Copilot may render any composed component as the turn's root", () => {
    expect(platformLibrary.root).toBeUndefined();
  });

  it("generates a non-empty system prompt mentioning SetupCard and a shared component", () => {
    const prompt = platformLibrary.prompt({ preamble: "test" });
    expect(prompt).toContain("SetupCard");
    expect(prompt).toContain("KpiGrid");
  });

  it("includes CRM and analytics components alongside campaign and shared ones", () => {
    const names = Object.keys(platformLibrary.components);
    expect(names).toContain("SetupCard");
    expect(names).toContain("StatCard");
    expect(names).toContain("OpportunityCard");
    expect(names).toContain("OpportunityList");
    expect(names).toContain("StageChangeConfirm");
    expect(names).toContain("TrendChart");
    expect(names).toContain("DataTable");
  });
});
