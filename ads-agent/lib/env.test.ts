import { beforeEach, describe, expect, it } from "vitest";
import { requireEnv } from "./env";

describe("requireEnv", () => {
  beforeEach(() => {
    delete process.env.TEST_VAR;
  });

  it("returns the value when set", () => {
    process.env.TEST_VAR = "hello";
    expect(requireEnv("TEST_VAR")).toBe("hello");
  });

  it("throws a named error when unset", () => {
    expect(() => requireEnv("TEST_VAR")).toThrow("TEST_VAR is not set");
  });
});
