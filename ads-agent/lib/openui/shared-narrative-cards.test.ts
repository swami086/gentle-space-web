import { describe, expect, it } from "vitest";
import { InsightCallout, InsightCalloutView, ChecklistCard, ChecklistCardView, AlertBanner, AlertBannerView } from "./shared-narrative-cards";

describe("InsightCalloutView", () => {
  it("renders a headline and optional supporting stat", () => {
    const tree = InsightCalloutView({ headline: "CPL rose because of a bid increase on Whitefield", supportingStat: "+₹40", tone: "negative" });
    expect(tree).toBeTruthy();
  });
  it("does not throw without optional props", () => {
    expect(() => InsightCalloutView({ headline: "All campaigns are healthy" })).not.toThrow();
  });
});
describe("InsightCallout (OpenUI component)", () => {
  it("is named InsightCallout", () => expect(InsightCallout.name).toBe("InsightCallout"));
});

describe("ChecklistCardView", () => {
  it("renders items with status icons", () => {
    const tree = ChecklistCardView({
      title: "3 things to review today",
      items: [
        { text: "Whitefield campaign is under budget", status: "warning" },
        { text: "2 hot leads unqualified >48h", status: "warning" },
        { text: "Weekly report sent", status: "done" },
      ],
    });
    expect(tree).toBeTruthy();
  });
  it("does not throw on an empty items array", () => {
    expect(() => ChecklistCardView({ items: [] })).not.toThrow();
  });
});
describe("ChecklistCard (OpenUI component)", () => {
  it("is named ChecklistCard", () => expect(ChecklistCard.name).toBe("ChecklistCard"));
});

describe("AlertBannerView", () => {
  it("renders severity, title, and detail", () => {
    const tree = AlertBannerView({ severity: "critical", title: "Campaign paused: over budget", detail: "Whitefield HSR Launch hit its daily cap at 11am." });
    expect(tree).toBeTruthy();
  });
  it("does not throw without detail", () => {
    expect(() => AlertBannerView({ severity: "info", title: "New lead assigned" })).not.toThrow();
  });
});
describe("AlertBanner (OpenUI component)", () => {
  it("is named AlertBanner", () => expect(AlertBanner.name).toBe("AlertBanner"));
});
