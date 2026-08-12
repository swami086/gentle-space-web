import { describe, expect, it } from "vitest";
import { slugifyOrgName } from "./orgs";

describe("slugifyOrgName", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyOrgName("Acme Realty")).toBe("acme-realty");
    expect(slugifyOrgName("Gentle Space (internal)")).toBe("gentle-space-internal");
  });

  it("rejects empty slugs", () => {
    expect(() => slugifyOrgName("!!!")).toThrow(/cannot derive slug/i);
  });
});
