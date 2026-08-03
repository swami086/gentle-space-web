import { describe, expect, it } from "vitest";
import {
  canAdvanceFromIdentify,
  nextStepIndex,
  previousStepIndex,
  wizardSteps,
} from "./wizard-steps";

describe("wizardSteps", () => {
  it("has 3 steps normally, 2 when property context skips details", () => {
    expect(wizardSteps(false)).toEqual(["identify", "details", "notes"]);
    expect(wizardSteps(true)).toEqual(["identify", "notes"]);
  });
});

describe("nextStepIndex / previousStepIndex", () => {
  it("clamps at the boundaries", () => {
    const steps = wizardSteps(false);
    expect(nextStepIndex(steps, 0)).toBe(1);
    expect(nextStepIndex(steps, 2)).toBe(2);
    expect(previousStepIndex(0)).toBe(0);
    expect(previousStepIndex(2)).toBe(1);
  });
});

describe("canAdvanceFromIdentify", () => {
  it("requires both name and phone", () => {
    expect(canAdvanceFromIdentify("Ada", "+91 1")).toBe(true);
    expect(canAdvanceFromIdentify("", "+91 1")).toBe(false);
    expect(canAdvanceFromIdentify("Ada", "  ")).toBe(false);
  });
});
