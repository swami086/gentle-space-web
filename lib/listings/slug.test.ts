import { describe, expect, it } from "vitest";
import { slugifyTitle } from "./slug";

describe("slugifyTitle", () => {
  it("slugifies title with sourceId suffix", () => {
    expect(slugifyTitle("WeWork Prestige Atlanta", "123")).toMatch(
      /wework-prestige-atlanta/,
    );
    expect(slugifyTitle("WeWork Prestige Atlanta", "123")).toContain("123");
  });

  it("lowercases and strips special characters", () => {
    expect(slugifyTitle("91Springboard - Koramangala!", "abc")).toBe(
      "91springboard-koramangala-abc",
    );
  });

  it("collapses consecutive hyphens", () => {
    expect(slugifyTitle("Foo---Bar", "x")).toBe("foo-bar-x");
  });

  it("truncates sourceId suffix to 12 chars", () => {
    const slug = slugifyTitle("Test Space", "abcdefghijklmnop");
    expect(slug).toBe("test-space-abcdefghijkl");
  });
});
