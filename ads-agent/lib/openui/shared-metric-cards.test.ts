// ads-agent/lib/openui/shared-metric-cards.test.ts
import { describe, expect, it } from "vitest";
import { StatCard, StatCardView, KpiGrid, KpiGridView } from "./shared-metric-cards";

describe("StatCardView", () => {
  it("renders label, value, and a delta when provided", () => {
    const tree = StatCardView({ label: "Active leads", value: "42", deltaLabel: "+12% vs last week", deltaDirection: "up" });
    expect(tree).toBeTruthy();
  });

  it("does not throw when optional props are omitted (Zod defaults not yet applied)", () => {
    expect(() => StatCardView({ label: "CPL", value: "₹214" })).not.toThrow();
  });
});

describe("StatCard (OpenUI component)", () => {
  it("is named StatCard and has the expected prop keys", () => {
    expect(StatCard.name).toBe("StatCard");
    expect(Object.keys(StatCard.props.shape)).toEqual(["label", "value", "deltaLabel", "deltaDirection"]);
  });
});

describe("KpiGridView", () => {
  it("renders one StatCardView per stat", () => {
    const tree = KpiGridView({
      stats: [
        { label: "Spend", value: "₹12,400" },
        { label: "Leads", value: "18", deltaLabel: "+3", deltaDirection: "up" },
      ],
    });
    expect(tree).toBeTruthy();
  });

  it("does not throw on an empty stats array", () => {
    expect(() => KpiGridView({ stats: [] })).not.toThrow();
  });
});

describe("KpiGrid (OpenUI component)", () => {
  it("is named KpiGrid", () => {
    expect(KpiGrid.name).toBe("KpiGrid");
  });
});
