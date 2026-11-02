import { describe, expect, it } from "vitest";
import { checkIndiaCopy } from "./india";

describe("checkIndiaCopy", () => {
  it("passes a normal office-lease sentence", () => {
    expect(
      checkIndiaCopy(
        "Furnished office space for lease in Koramangala, 1,200 sq ft, ready to move in.",
      ),
    ).toEqual({ ok: true });
  });

  it("rejects sales language", () => {
    expect(checkIndiaCopy("Commercial unit for sale in Whitefield.")).toEqual({
      ok: false,
      reason: "Lease ads must not use sales language",
    });
    expect(checkIndiaCopy("Buy now — premium office in BKC.")).toEqual({
      ok: false,
      reason: "Lease ads must not use sales language",
    });
    expect(checkIndiaCopy("Freehold office with parking.")).toEqual({
      ok: false,
      reason: "Lease ads must not use sales language",
    });
  });

  it("rejects discriminatory wording", () => {
    expect(checkIndiaCopy("Office lease — Brahmin caste preferred.")).toEqual({
      ok: false,
      reason: "Lease ads must not use discriminatory eligibility wording",
    });
    expect(checkIndiaCopy("Only Hindus may apply for this suite.")).toEqual({
      ok: false,
      reason: "Lease ads must not use discriminatory eligibility wording",
    });
    expect(checkIndiaCopy("Muslims only — ground floor office.")).toEqual({
      ok: false,
      reason: "Lease ads must not use discriminatory eligibility wording",
    });
    expect(checkIndiaCopy("No other race — office for lease.")).toEqual({
      ok: false,
      reason: "Lease ads must not use discriminatory eligibility wording",
    });
  });
});
