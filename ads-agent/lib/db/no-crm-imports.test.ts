import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The structural reason an enquiry survives Twenty being down: the data layer
 * cannot reach Twenty even by accident. A functional test can be satisfied by a
 * mock; this cannot.
 */
describe("the enquiry data layer never imports the Twenty boundary", () => {
  const files = readdirSync(__dirname).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it.each(files)("lib/db/%s has no crm import", (file) => {
    const src = readFileSync(join(__dirname, file), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*crm\//);
    expect(src).not.toMatch(/import\(\s*["'][^"']*crm\//);
  });

  it("checks a non-empty set of files", () => {
    expect(files.length).toBeGreaterThan(5);
  });
});
