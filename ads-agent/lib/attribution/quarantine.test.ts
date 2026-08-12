import { describe, it, expect } from "vitest";
import {
  assertNotSoleDerivedJustification,
  DerivedOnlyJustificationError,
  type Justification,
} from "./quarantine";

const derived: Justification = { authority: "derived", ref: "derived.corridor_attribution_daily:1" };
const record: Justification = { authority: "record", ref: "adsagent.enquiries:2" };

describe("assertNotSoleDerivedJustification", () => {
  it("accepts a justification anchored in a record", () => {
    expect(() => assertNotSoleDerivedJustification([derived, record])).not.toThrow();
  });

  it("rejects a justification built only from derived figures", () => {
    expect(() => assertNotSoleDerivedJustification([derived, derived])).toThrow(
      DerivedOnlyJustificationError,
    );
  });

  it("rejects no justification at all", () => {
    expect(() => assertNotSoleDerivedJustification([])).toThrow(DerivedOnlyJustificationError);
  });

  it("names the quarantine rule in the message so the reason is not guessed", () => {
    expect(() => assertNotSoleDerivedJustification([derived])).toThrow(/quarantine/i);
  });
});
