import { describe, expect, it } from "vitest";
import { normalizeName } from "./normalize";

describe("normalizeName", () => {
  it("lowercases and replaces non-alphanumeric with spaces", () => {
    expect(normalizeName("WeWork Prestige!")).toBe("wework prestige");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeName("  91Springboard  ")).toBe("91springboard");
  });

  it("collapses punctuation runs into single spaces", () => {
    expect(normalizeName("Foo---Bar")).toBe("foo bar");
  });
});
