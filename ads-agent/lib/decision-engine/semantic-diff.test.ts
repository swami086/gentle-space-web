import { describe, expect, it } from "vitest";
import { semanticDiff } from "./semantic-diff";

describe("semanticDiff", () => {
  it("budget_change diffs dailyBudgetInr from live to payload", () => {
    expect(
      semanticDiff({
        kind: "budget_change",
        payload: { campaignId: "c1", newDailyBudgetInr: 1500 },
        live: { dailyBudgetInr: 1000 },
      }),
    ).toEqual([{ field: "dailyBudgetInr", before: 1000, after: 1500 }]);
  });

  it("pause diffs status to paused, defaulting live status to active", () => {
    expect(
      semanticDiff({
        kind: "pause",
        payload: { campaignId: "c1" },
      }),
    ).toEqual([{ field: "status", before: "active", after: "paused" }]);
  });

  it("pause uses live status when present", () => {
    expect(
      semanticDiff({
        kind: "pause",
        payload: { campaignId: "c1" },
        live: { status: "active" },
      }),
    ).toEqual([{ field: "status", before: "active", after: "paused" }]);
  });

  it("create_campaign enumerates payload fields with before=null", () => {
    expect(
      semanticDiff({
        kind: "create_campaign",
        payload: { dailyBudgetInr: 500, adGroupName: "Whitefield Office Space" },
      }),
    ).toEqual([
      { field: "dailyBudgetInr", before: null, after: 500 },
      { field: "adGroupName", before: null, after: "Whitefield Office Space" },
    ]);
  });

  it("add_negative_keyword diffs keyword text", () => {
    expect(
      semanticDiff({
        kind: "add_negative_keyword",
        payload: { campaignId: "c1", text: "residential" },
      }),
    ).toEqual([{ field: "keyword", before: null, after: "residential" }]);
  });

  it("enquiry.requirement_update enumerates payload.diff keys", () => {
    expect(
      semanticDiff({
        kind: "enquiry.requirement_update",
        payload: {
          enquiry_id: "e1",
          diff: { desks: 40, corridor: "Bandra" },
        },
      }),
    ).toEqual([
      { field: "desks", before: null, after: 40 },
      { field: "corridor", before: null, after: "Bandra" },
    ]);
  });

  it("enquiry.requirement_update supports before/after entries in diff", () => {
    expect(
      semanticDiff({
        kind: "enquiry.requirement_update",
        payload: {
          diff: { desks: { before: 20, after: 40 } },
        },
      }),
    ).toEqual([{ field: "desks", before: 20, after: 40 }]);
  });

  it("returns empty array for unknown kinds", () => {
    expect(
      semanticDiff({
        kind: "future_kind",
        payload: { foo: "bar" },
      }),
    ).toEqual([]);
  });

  it("strips smuggled chars from string before/after values", () => {
    expect(
      semanticDiff({
        kind: "pause",
        payload: { campaignId: "c1" },
        live: { status: "act\u200Bive" },
      }),
    ).toEqual([{ field: "status", before: "active", after: "paused" }]);

    expect(
      semanticDiff({
        kind: "add_negative_keyword",
        payload: { text: "res\u200Bidential" },
      }),
    ).toEqual([{ field: "keyword", before: null, after: "residential" }]);
  });
});
