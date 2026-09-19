import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("lib/db/client search_path", () => {
  it("pins ag_catalog,listings,public so unqualified FROM listings resolves", () => {
    const src = readFileSync(join(__dirname, "client.ts"), "utf8");
    expect(src).toMatch(/LISTINGS_SEARCH_PATH\s*=\s*"ag_catalog,listings,public"/);
    expect(src).toMatch(/options:\s*`-c search_path=\$\{LISTINGS_SEARCH_PATH\}`/);
  });
});
