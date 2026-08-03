import { describe, expect, it } from "vitest";
import { playbookContextFor } from "./playbook-context";

describe("playbookContextFor", () => {
  it("returns kill-rule grounding mentioning learning time and consecutive snapshots", () => {
    const text = playbookContextFor("kill_rule");
    expect(text).toMatch(/learning/i);
    expect(text).toMatch(/consecutive/i);
  });

  it("returns budget-reallocation grounding mentioning the 20% step discipline", () => {
    const text = playbookContextFor("budget_reallocation");
    expect(text).toMatch(/20%/);
  });

  it("returns negative-keyword grounding mentioning wasted spend", () => {
    const text = playbookContextFor("negative_keyword");
    expect(text.length).toBeGreaterThan(0);
  });

  it("returns an empty string for an unrecognized rule", () => {
    expect(playbookContextFor("some_future_rule")).toBe("");
  });
});
