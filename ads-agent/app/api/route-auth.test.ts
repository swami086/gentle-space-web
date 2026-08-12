import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Every route below performs a mutation or exposes org-wide configuration.
const GUARDED_ROUTES = [
  "settings/route.ts",
  "cycle/run/route.ts",
  "proposals/[id]/route.ts",
  "proposals/[id]/approve/route.ts",
  "proposals/[id]/reject/route.ts",
  "campaign-drafts/[id]/route.ts",
  "campaign-drafts/[id]/create-proposal/route.ts",
];

describe("every mutation route is guarded", () => {
  it.each(GUARDED_ROUTES)("%s calls requireApiRole", (rel) => {
    const src = readFileSync(join(__dirname, rel), "utf8");
    expect(src).toContain("requireApiRole");
  });

  it.each(GUARDED_ROUTES)("%s returns the guard's response on failure", (rel) => {
    const src = readFileSync(join(__dirname, rel), "utf8");
    expect(src).toContain("if (!access.ok) return access.response;");
  });
});
