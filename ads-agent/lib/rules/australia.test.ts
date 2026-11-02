import { describe, expect, it } from "vitest";
import { checkAustraliaCopy } from "./australia";

describe("checkAustraliaCopy", () => {
  it("passes a single fixed rent with period", () => {
    expect(
      checkAustraliaCopy("Modern office in Sydney CBD. Rent $2,400 per week plus GST."),
    ).toEqual({ ok: true });
    expect(checkAustraliaCopy("AUD 2400 per week — Parramatta office lease.")).toEqual({
      ok: true,
    });
  });

  it("rejects rent ranges", () => {
    expect(checkAustraliaCopy("Office lease $2,000 to $2,400 per week.")).toEqual({
      ok: false,
      reason: "Lease ads must state one fixed rent, not a range",
    });
    expect(checkAustraliaCopy("Rent $2,000-$2,400 per week in Melbourne.")).toEqual({
      ok: false,
      reason: "Lease ads must state one fixed rent, not a range",
    });
  });

  it("rejects from-pricing and POA", () => {
    expect(checkAustraliaCopy("Office from $2,000 per week in Brisbane.")).toEqual({
      ok: false,
      reason: "Lease ads must state one fixed rent, not a starting price",
    });
    expect(checkAustraliaCopy("Premium suite — rent POA, contact agent.")).toEqual({
      ok: false,
      reason: "Lease ads must state a fixed rent, not POA",
    });
  });

  it("rejects copy with no rent stated", () => {
    expect(checkAustraliaCopy("Bright office in Perth CBD, enquire today.")).toEqual({
      ok: false,
      reason: "Lease ads must include one fixed rent with week or month",
    });
  });
});
