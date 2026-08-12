import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatCompletion } = vi.hoisted(() => ({
  chatCompletion: vi.fn(),
}));

vi.mock("../bifrost/client", () => ({
  chatCompletion,
  isBifrostConfigured: () => true,
  firstChoiceContent: (r: { choices?: { message?: { content?: string } }[] }) =>
    r.choices?.[0]?.message?.content,
}));
vi.mock("@/lib/bifrost/client", () => ({
  chatCompletion,
  isBifrostConfigured: () => true,
  firstChoiceContent: (r: { choices?: { message?: { content?: string } }[] }) =>
    r.choices?.[0]?.message?.content,
}));

import { parseRequirementDiff } from "./requirement-extraction";

function reply(content: string) {
  return { choices: [{ message: { content } }] };
}

describe("parseRequirementDiff", () => {
  it("keeps the fields it understands", () => {
    expect(
      parseRequirementDiff(
        JSON.stringify({
          desksMin: 38,
          desksMax: 38,
          budgetPerDeskInr: 9500,
          moveInBy: "2026-09-01",
          mustHaves: ["metro walkable"],
        }),
      ),
    ).toEqual({
      desksMin: 38,
      desksMax: 38,
      budgetPerDeskInr: 9500,
      moveInBy: "2026-09-01",
      mustHaves: ["metro walkable"],
    });
  });

  it("drops an impossible value instead of letting it reach a CHECK constraint", () => {
    expect(parseRequirementDiff(JSON.stringify({ desksMin: -3, desksMax: 40 }))).toEqual({
      desksMax: 40,
    });
  });

  it("drops a range that is the wrong way round", () => {
    expect(parseRequirementDiff(JSON.stringify({ desksMin: 40, desksMax: 10 }))).toEqual({});
  });

  it("returns an empty patch for prose, not a throw", () => {
    expect(parseRequirementDiff("I could not find any requirements.")).toEqual({});
  });

  it("returns an empty patch for undefined", () => {
    expect(parseRequirementDiff(undefined)).toEqual({});
  });

  it("ignores keys that are not requirement fields", () => {
    expect(parseRequirementDiff(JSON.stringify({ desksMin: 12, tier: "hot" }))).toEqual({
      desksMin: 12,
    });
  });
});

describe("extractRequirementDiff", () => {
  beforeEach(() => {
    chatCompletion.mockReset();
    vi.resetModules();
  });

  it("asks for strict JSON and returns the validated patch", async () => {
    chatCompletion.mockResolvedValue(reply(JSON.stringify({ desksMin: 38, desksMax: 38 })));
    const { extractRequirementDiff } = await import("./requirement-extraction");
    await expect(extractRequirementDiff("They settled on 38 desks")).resolves.toEqual({
      desksMin: 38,
      desksMax: 38,
    });
    const options = chatCompletion.mock.calls[0][0];
    expect(options.responseFormat?.type).toBe("json_schema");
    expect(options.temperature).toBe(0);
  });

  it("returns an empty patch when the model call fails, rather than throwing at the broker", async () => {
    chatCompletion.mockRejectedValue(new Error("upstream 503"));
    const { extractRequirementDiff } = await import("./requirement-extraction");
    await expect(extractRequirementDiff("They settled on 38 desks")).resolves.toEqual({});
  });

  it("does not call the model for empty notes", async () => {
    const { extractRequirementDiff } = await import("./requirement-extraction");
    await expect(extractRequirementDiff("   ")).resolves.toEqual({});
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});

describe("the extract route cannot apply a requirement (C3)", () => {
  const src = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "app",
      "api",
      "enquiries",
      "[id]",
      "requirements",
      "extract",
      "route.ts",
    ),
    "utf8",
  );

  it("does not import upsertRequirement", () => {
    expect(src).not.toContain("upsertRequirement");
  });

  it("does not import applyRevision", () => {
    expect(src).not.toContain("applyRevision");
  });

  it("creates a revision, which starts unapplied", () => {
    expect(src).toContain("createRevision");
  });
});
