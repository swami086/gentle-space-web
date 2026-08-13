import { describe, expect, it } from "vitest";
import { stripSmuggle } from "./strip-smuggle";

describe("stripSmuggle", () => {
  it("removes zero-width and tag-block chars", () => {
    expect(stripSmuggle("hello\u200Bworld")).toBe("helloworld");
    expect(stripSmuggle("a\u{E0061}b")).toBe("ab");
  });

  it("leaves normal text", () => {
    expect(stripSmuggle("Raise budget to ₹500")).toBe("Raise budget to ₹500");
  });
});
