import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as rules from "./rules";

describe("listing decision rules guardrails", () => {
  it("does not export rule ids or names that mention share reallocation", () => {
    const exportNames = Object.keys(rules);
    for (const name of exportNames) {
      expect(name.toLowerCase()).not.toMatch(/share|reallocate/);
    }
  });

  it("does not reference listing_shares in rules source", () => {
    const rulesPath = join(dirname(fileURLToPath(import.meta.url)), "rules.ts");
    expect(readFileSync(rulesPath, "utf8")).not.toContain("listing_shares");
  });
});
