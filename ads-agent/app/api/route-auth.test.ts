import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const GUARDED_ROUTES = [
  "settings/route.ts",
  "cycle/run/route.ts",
  "proposals/[id]/route.ts",
  "proposals/[id]/approve/route.ts",
  "proposals/[id]/reject/route.ts",
  "campaign-drafts/[id]/route.ts",
  "campaign-drafts/[id]/create-proposal/route.ts",
  "campaign-drafts/[id]/messages/route.ts",
  "campaigns/[id]/status/route.ts",
  "credits/grant/route.ts",
  "crm/opportunities/[id]/stage/route.ts",
];

describe("every mutation route is guarded", () => {
  it.each(GUARDED_ROUTES)("%s calls guard", (rel) => {
    const src = readFileSync(join(__dirname, rel), "utf8");
    expect(src).toContain("await guard(");
  });

  it.each(GUARDED_ROUTES)("%s returns the guard's response on failure", (rel) => {
    const src = readFileSync(join(__dirname, rel), "utf8");
    expect(src).toContain("if (!access.ok) return access.response;");
  });

  it.each(GUARDED_ROUTES)("%s never returns 403 for a missing entity", (rel) => {
    const src = readFileSync(join(__dirname, rel), "utf8");
    expect(src).not.toMatch(/"not found".*403|403.*"not found"/);
  });
});
