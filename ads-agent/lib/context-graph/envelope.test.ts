import { describe, it, expect, beforeEach } from "vitest";
import { openSecret, sealSecret } from "./envelope";

beforeEach(() => {
  process.env.SNAPSHOT_MASTER_KEY = "a".repeat(64);
});

describe("envelope", () => {
  it("round-trips", () => {
    expect(openSecret(sealSecret("hello")).toString("utf8")).toBe("hello");
  });

  it("is non-deterministic, so two seals of one value differ", () => {
    expect(sealSecret("hello").equals(sealSecret("hello"))).toBe(false);
  });

  it("rejects a tampered ciphertext rather than returning garbage", () => {
    const sealed = sealSecret("hello");
    sealed[sealed.length - 1] ^= 0xff;
    expect(() => openSecret(sealed)).toThrow();
  });

  it("refuses to run without a 32-byte master key", () => {
    process.env.SNAPSHOT_MASTER_KEY = "tooshort";
    expect(() => sealSecret("hello")).toThrow(/SNAPSHOT_MASTER_KEY/);
  });
});
