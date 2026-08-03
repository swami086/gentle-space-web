import { describe, expect, it } from "vitest";
import { foldStep2Answers, step2FieldsFor, STEP2_FIELDS } from "./step2-fields";

describe("step2FieldsFor", () => {
  it("returns 3 fields for each need type", () => {
    expect(step2FieldsFor("office")).toHaveLength(3);
    expect(step2FieldsFor("retail")).toHaveLength(3);
    expect(step2FieldsFor("lease")).toHaveLength(3);
  });

  it("returns unique keys within each need", () => {
    for (const need of Object.keys(STEP2_FIELDS) as (keyof typeof STEP2_FIELDS)[]) {
      const keys = STEP2_FIELDS[need].map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("office fields cover team size, area, timeline", () => {
    const keys = step2FieldsFor("office").map((f) => f.key);
    expect(keys).toEqual(["teamSize", "preferredArea", "moveInTimeline"]);
  });
});

describe("foldStep2Answers", () => {
  it("joins labeled answers and notes into one string", () => {
    const text = foldStep2Answers(
      "office",
      { teamSize: "15 desks", preferredArea: "Koramangala" },
      "Need by month end",
    );
    expect(text).toBe(
      "Team size / desks: 15 desks. Preferred area or corridor: Koramangala. Need by month end",
    );
  });

  it("skips blank answers and works with no answers at all", () => {
    expect(foldStep2Answers("office", undefined, "Just browsing")).toBe("Just browsing");
    expect(foldStep2Answers("office", {}, "")).toBe("");
  });
});
