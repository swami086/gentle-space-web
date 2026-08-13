import { describe, expect, it } from "vitest";
import {
  foldStep2Answers,
  step2FieldsFor,
  STEP2_FIELDS,
  TIMELINE_BUCKETS,
  step2FieldDisplayLabel,
} from "./step2-fields";

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

describe("timeline choice fields", () => {
  it("exposes four timeline buckets", () => {
    expect([...TIMELINE_BUCKETS]).toEqual([
      "Immediate (this month)",
      "1–3 months",
      "3–6 months",
      "Just exploring",
    ]);
  });

  it("marks office moveInTimeline and retail timeline as choice fields", () => {
    const officeTimeline = step2FieldsFor("office").find((f) => f.key === "moveInTimeline");
    const retailTimeline = step2FieldsFor("retail").find((f) => f.key === "timeline");
    expect(officeTimeline?.kind).toBe("choice");
    expect(officeTimeline?.choices).toEqual(TIMELINE_BUCKETS);
    expect(retailTimeline?.kind).toBe("choice");
    expect(retailTimeline?.choices).toEqual(TIMELINE_BUCKETS);
  });

  it("keeps lease expectedRentTimeline as free text", () => {
    const field = step2FieldsFor("lease").find((f) => f.key === "expectedRentTimeline");
    expect(field?.kind ?? "text").toBe("text");
    expect(field?.choices).toBeUndefined();
  });

  it("folds a chosen timeline bucket like any other string answer", () => {
    const text = foldStep2Answers(
      "office",
      { moveInTimeline: "Immediate (this month)" },
      "",
    );
    expect(text).toBe("Move-in timeline: Immediate (this month)");
  });

  it("appends (optional) to Step 2 display labels", () => {
    const field = step2FieldsFor("office")[0];
    expect(step2FieldDisplayLabel(field)).toBe(`${field.label} (optional)`);
  });
});
