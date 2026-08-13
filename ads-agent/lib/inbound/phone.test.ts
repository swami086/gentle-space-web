import { describe, expect, it } from "vitest";
import { normalizeToE164 } from "./phone";

describe("normalizeToE164", () => {
  it("prefixes 10-digit IN local numbers with +91", () => {
    expect(normalizeToE164("9876543210", "IN")).toBe("+919876543210");
  });

  it("keeps an already E.164 number unchanged", () => {
    expect(normalizeToE164("+919876543210")).toBe("+919876543210");
  });

  it("returns null for garbage input", () => {
    expect(normalizeToE164("not-a-phone")).toBeNull();
  });

  it("strips formatting while preserving a leading plus", () => {
    expect(normalizeToE164("+91 98765 43210")).toBe("+919876543210");
  });

  it("requires defaultCountry IN for bare 10-digit numbers", () => {
    expect(normalizeToE164("9876543210")).toBeNull();
  });

  it("rejects plus-prefixed numbers shorter than 10 characters", () => {
    expect(normalizeToE164("+12345")).toBeNull();
  });
});
