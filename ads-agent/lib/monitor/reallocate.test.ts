import { describe, expect, it } from "vitest";
import { reallocateListing, type ReallocateListingInput } from "./reallocate";

function baseInput(
  overrides: Partial<ReallocateListingInput> = {},
): ReallocateListingInput {
  return {
    writesEnabled: true,
    dayNumber: 3,
    alreadyMovedToday: false,
    ceilingChangedToday: false,
    ceilingMinor: 30_000,
    shares: [
      { id: "a", budgetMinor: 10_000, spendMinor: 2_000, leads: 0 },
      { id: "b", budgetMinor: 10_000, spendMinor: 3_000, leads: 2 },
      { id: "c", budgetMinor: 10_000, spendMinor: 1_000, leads: 1 },
    ],
    ...overrides,
  };
}

describe("reallocateListing skips", () => {
  it("when writes are disabled", () => {
    expect(reallocateListing(baseInput({ writesEnabled: false }))).toEqual({
      action: "skip",
      reason: "writes_disabled",
    });
  });

  it("before day 3", () => {
    expect(reallocateListing(baseInput({ dayNumber: 2 }))).toEqual({
      action: "skip",
      reason: "before_day_three",
    });
  });

  it("when already moved today", () => {
    expect(reallocateListing(baseInput({ alreadyMovedToday: true }))).toEqual({
      action: "skip",
      reason: "already_moved_today",
    });
  });

  it("when the ceiling changed today", () => {
    expect(reallocateListing(baseInput({ ceilingChangedToday: true }))).toEqual({
      action: "skip",
      reason: "ceiling_changed_today",
    });
  });

  it("when every share has at least one lead", () => {
    expect(
      reallocateListing(
        baseInput({
          shares: [
            { id: "a", budgetMinor: 10_000, spendMinor: 1_000, leads: 1 },
            { id: "b", budgetMinor: 10_000, spendMinor: 1_000, leads: 2 },
            { id: "c", budgetMinor: 10_000, spendMinor: 1_000, leads: 1 },
          ],
        }),
      ),
    ).toEqual({ action: "skip", reason: "all_shares_have_leads" });
  });

  it("when no share has a lead", () => {
    expect(
      reallocateListing(
        baseInput({
          shares: [
            { id: "a", budgetMinor: 10_000, spendMinor: 1_000, leads: 0 },
            { id: "b", budgetMinor: 10_000, spendMinor: 1_000, leads: 0 },
            { id: "c", budgetMinor: 10_000, spendMinor: 1_000, leads: 0 },
          ],
        }),
      ),
    ).toEqual({ action: "skip", reason: "no_share_has_leads" });
  });

  it("when share budgets do not sum to the ceiling", () => {
    expect(
      reallocateListing(
        baseInput({
          ceilingMinor: 25_000,
        }),
      ),
    ).toEqual({ action: "skip", reason: "infeasible" });
  });
});

describe("reallocateListing move", () => {
  it("moves unspent budget from zero-lead shares to lead shares by lead weight", () => {
    const result = reallocateListing(baseInput());

    expect(result).toEqual({
      action: "move",
      shares: [
        { id: "a", budgetMinor: 2_000 },
        { id: "b", budgetMinor: 15_333 },
        { id: "c", budgetMinor: 12_667 },
      ],
      text: {
        oldShares: [10_000, 10_000, 10_000],
        newShares: [2_000, 15_333, 12_667],
        ceilingMinor: 30_000,
      },
    });

    if (result.action === "move") {
      const sum = result.shares.reduce((s, row) => s + row.budgetMinor, 0);
      expect(sum).toBe(30_000);
      expect(result.shares[0].budgetMinor).toBeGreaterThanOrEqual(2_000);
      expect(result.shares[1].budgetMinor).toBeGreaterThanOrEqual(3_000);
      expect(result.shares[2].budgetMinor).toBeGreaterThanOrEqual(1_000);
    }
  });
});
