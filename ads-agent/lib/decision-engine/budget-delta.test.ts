import { describe, expect, it } from "vitest";
import { budgetDeltaInr } from "./budget-delta";

describe("budgetDeltaInr", () => {
  it("returns new minus current for budget_change", () => {
    expect(
      budgetDeltaInr({
        kind: "budget_change",
        payload: { campaignId: "camp-1", newDailyBudgetInr: 600 },
        currentDailyBudgetInr: 500,
      }),
    ).toBe(100);
  });

  it("treats missing current budget as zero for budget_change", () => {
    expect(
      budgetDeltaInr({
        kind: "budget_change",
        payload: { newDailyBudgetInr: 400 },
        currentDailyBudgetInr: null,
      }),
    ).toBe(400);
  });

  it("returns positive daily budget for create_campaign from dailyBudgetInr", () => {
    expect(
      budgetDeltaInr({
        kind: "create_campaign",
        payload: { dailyBudgetInr: 500, corridor: "whitefield" },
      }),
    ).toBe(500);
  });

  it("falls back to newDailyBudgetInr for create_campaign", () => {
    expect(
      budgetDeltaInr({
        kind: "create_campaign",
        payload: { newDailyBudgetInr: 750 },
      }),
    ).toBe(750);
  });

  it("prefers dailyBudgetInr over newDailyBudgetInr for create_campaign", () => {
    expect(
      budgetDeltaInr({
        kind: "create_campaign",
        payload: { dailyBudgetInr: 500, newDailyBudgetInr: 750 },
      }),
    ).toBe(500);
  });

  it("returns negative current budget for pause (budget freed)", () => {
    expect(
      budgetDeltaInr({
        kind: "pause",
        payload: { campaignId: "camp-1" },
        currentDailyBudgetInr: 500,
      }),
    ).toBe(-500);
  });

  it("returns zero for pause when current budget is unknown", () => {
    expect(
      budgetDeltaInr({
        kind: "pause",
        payload: { campaignId: "camp-1" },
        currentDailyBudgetInr: null,
      }),
    ).toBe(0);
  });

  it("returns null for kinds without budget impact", () => {
    expect(
      budgetDeltaInr({
        kind: "add_negative_keyword",
        payload: { keyword: "residential" },
        currentDailyBudgetInr: 500,
      }),
    ).toBeNull();
    expect(
      budgetDeltaInr({
        kind: "campaign_strategy",
        payload: {},
      }),
    ).toBeNull();
  });
});
