import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("lib/db/client search_path", () => {
  it("pins ag_catalog,adsagent,public so unqualified metering SQL resolves", () => {
    const src = readFileSync(join(__dirname, "client.ts"), "utf8");
    expect(src).toMatch(/ADSAGENT_SEARCH_PATH\s*=\s*"ag_catalog,adsagent,public"/);
    expect(src).toMatch(/options:\s*`-c search_path=\$\{ADSAGENT_SEARCH_PATH\}`/);
  });
});
