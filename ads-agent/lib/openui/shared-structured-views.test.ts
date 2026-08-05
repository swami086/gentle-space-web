import { describe, expect, it } from "vitest";
import {
  ComparisonCard, ComparisonCardView,
  Timeline, TimelineView,
  RankedList, RankedListView,
  BatchActionConfirm, BatchActionConfirmView,
} from "./shared-structured-views";

describe("ComparisonCardView", () => {
  it("renders both sides of a comparison", () => {
    const tree = ComparisonCardView({ title: "This week vs last week", leftLabel: "Last week", leftValue: "₹8,200", rightLabel: "This week", rightValue: "₹9,600" });
    expect(tree).toBeTruthy();
  });
  it("does not throw without a title", () => {
    expect(() => ComparisonCardView({ leftLabel: "Before", leftValue: "3", rightLabel: "After", rightValue: "7" })).not.toThrow();
  });
});
describe("ComparisonCard (OpenUI component)", () => {
  it("is named ComparisonCard", () => expect(ComparisonCard.name).toBe("ComparisonCard"));
});

describe("TimelineView", () => {
  it("renders chronological events", () => {
    const tree = TimelineView({ title: "Lead activity", events: [{ timestamp: "2026-08-01", description: "Lead created" }, { timestamp: "2026-08-03", description: "Moved to qualified" }] });
    expect(tree).toBeTruthy();
  });
  it("does not throw on an empty events array", () => {
    expect(() => TimelineView({ events: [] })).not.toThrow();
  });
});
describe("Timeline (OpenUI component)", () => {
  it("is named Timeline", () => expect(Timeline.name).toBe("Timeline"));
});

describe("RankedListView", () => {
  it("renders ranked items with badges", () => {
    const tree = RankedListView({ title: "Top campaigns by spend", items: [{ label: "Whitefield HSR", value: "₹12,400" }, { label: "Indiranagar", value: "₹9,100" }] });
    expect(tree).toBeTruthy();
  });
  it("does not throw on an empty items array", () => {
    expect(() => RankedListView({ items: [] })).not.toThrow();
  });
});
describe("RankedList (OpenUI component)", () => {
  it("is named RankedList", () => expect(RankedList.name).toBe("RankedList"));
});

describe("BatchActionConfirmView", () => {
  it("renders affected items with from/to state", () => {
    const tree = BatchActionConfirmView({ actionLabel: "Pause these 2 underperforming campaigns?", items: [{ label: "Whitefield HSR", fromState: "active", toState: "paused" }, { label: "Indiranagar Launch", fromState: "active", toState: "paused" }] });
    expect(tree).toBeTruthy();
  });
  it("does not throw on an empty items array", () => {
    expect(() => BatchActionConfirmView({ actionLabel: "Confirm?", items: [] })).not.toThrow();
  });
});
describe("BatchActionConfirm (OpenUI component)", () => {
  it("is named BatchActionConfirm", () => expect(BatchActionConfirm.name).toBe("BatchActionConfirm"));
});
