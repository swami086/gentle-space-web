import { describe, expect, it } from "vitest";
import { TrendChartView, DataTableView, analyticsLibrary } from "./analytics-library";

describe("analyticsLibrary", () => {
  it("registers TrendChart and DataTable", () => {
    expect(Object.keys(analyticsLibrary.components).sort()).toEqual(["DataTable", "TrendChart"].sort());
  });
});

describe("TrendChartView", () => {
  it("renders every point's label", () => {
    const tree = TrendChartView({
      title: "CPL trend",
      points: [{ label: "Google", value: 142 }, { label: "Meta", value: 188 }],
    });
    const json = JSON.stringify(tree);
    expect(json).toContain("Google");
    expect(json).toContain("Meta");
    expect(json).toContain("CPL trend");
  });
});

describe("DataTableView", () => {
  it("renders headers and every row's cells", () => {
    const tree = DataTableView({
      headers: ["Campaign", "Spend"],
      rows: [{ cells: ["Whitefield HSR Launch", "₹15,000"] }],
    });
    const json = JSON.stringify(tree);
    expect(json).toContain("Campaign");
    expect(json).toContain("Whitefield HSR Launch");
  });

  it("renders an empty-state message for zero rows", () => {
    const tree = DataTableView({ headers: ["A"], rows: [] });
    expect(JSON.stringify(tree)).toContain("No data");
  });
});
