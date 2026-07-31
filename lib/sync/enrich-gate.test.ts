import { describe, expect, it } from "vitest";
import { gateLocation, gatePrice, normalizeLocalityKey, type ExtractResult } from "./enrich-gate";

const medium: ExtractResult = {
  locality: "HSR Layout",
  address: null,
  monthly_price_inr: 20000,
  price_basis: "exact",
  brand_match: true,
  confidence: "medium",
  evidence: "Pricing Plans section",
};

describe("gateLocation", () => {
  it("accepts medium+ locality that looksLikeLocality", () => {
    const g = gateLocation(medium);
    expect(g.accept).toBe(true);
    if (g.accept) expect(g.area).toBe("HSR Layout");
  });

  it("rejects bare city and junk locality", () => {
    expect(gateLocation({ ...medium, locality: "Bengaluru" }).accept).toBe(false);
    expect(gateLocation({ ...medium, locality: "2nd Floor" }).accept).toBe(false);
  });

  it("rejects low confidence unless Pass1≈Pass2 locality", () => {
    expect(gateLocation({ ...medium, confidence: "low" }).accept).toBe(false);
    expect(
      gateLocation(
        { ...medium, confidence: "low", locality: "Whitefield" },
        { pass2Locality: "whitefield" },
      ).accept,
    ).toBe(true);
  });

  it("prefers full postal address when hasCityMarker", () => {
    const g = gateLocation({
      ...medium,
      address: "27th Main, HSR Layout, Bengaluru, Karnataka 560102, India",
    });
    expect(g.accept).toBe(true);
    if (g.accept) {
      expect(g.address).toContain("Bengaluru");
      expect(g.area).toBe("HSR Layout"); // localityFromAddress or locality field
    }
  });
});

describe("gatePrice", () => {
  it("accepts medium+ monthly and formats via formatPricingHint", () => {
    const g = gatePrice(medium, "Price on request");
    expect(g.accept).toBe(true);
    if (g.accept) expect(g.pricingHint).toBe("₹20,000/month");
  });

  it("prefixes from when price_basis is from", () => {
    const g = gatePrice({ ...medium, price_basis: "from" }, null);
    expect(g.accept).toBe(true);
    if (g.accept) expect(g.pricingHint).toMatch(/^from ₹/);
  });

  it("does not overwrite a usable existing price", () => {
    expect(gatePrice(medium, "₹15,000/month").accept).toBe(false);
  });

  it("rejects low confidence price", () => {
    expect(gatePrice({ ...medium, confidence: "low" }, null).accept).toBe(false);
  });
});

describe("normalizeLocalityKey", () => {
  it("collapses case and whitespace", () => {
    expect(normalizeLocalityKey("  HSR Layout ")).toBe("hsr layout");
  });
});

