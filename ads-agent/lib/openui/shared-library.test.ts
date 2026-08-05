import { describe, expect, it } from "vitest";
import { sharedLibrary } from "./shared-library";

describe("sharedLibrary", () => {
  it("registers exactly the nine shared components, no duplicates", () => {
    const names = Object.keys(sharedLibrary.components).sort();
    expect(names).toEqual(
      [
        "AlertBanner", "BatchActionConfirm", "ChecklistCard", "ComparisonCard",
        "InsightCallout", "KpiGrid", "RankedList", "StatCard", "Timeline",
      ].sort(),
    );
  });

  it("has no fixed root — the model may render any registered component as the turn's root", () => {
    expect(sharedLibrary.root).toBeUndefined();
  });

  it("generates a non-empty system prompt mentioning every component", () => {
    const prompt = sharedLibrary.prompt({ preamble: "test" });
    for (const name of ["StatCard", "KpiGrid", "InsightCallout", "ChecklistCard", "AlertBanner", "ComparisonCard", "Timeline", "RankedList", "BatchActionConfirm"]) {
      expect(prompt).toContain(name);
    }
  });
});
