import { describe, expect, it } from "vitest";
import {
  extractPricingHint,
  formatPricingHint,
  normalizePriceUnit,
  parseStoredPrice,
  unitAfterAmount,
} from "./price";

describe("normalizePriceUnit", () => {
  it("prefers the time unit over a seat qualifier", () => {
    expect(normalizePriceUnit("/pp/day")).toBe("day");
    expect(normalizePriceUnit("/ desk / month")).toBe("month");
    expect(normalizePriceUnit("price / person / month")).toBe("month");
  });

  it("reads bare seat units when no time unit is present", () => {
    expect(normalizePriceUnit("/\\* seat")).toBe("seat");
    expect(normalizePriceUnit("price / person")).toBe("seat");
  });

  it("recognises the remaining units", () => {
    expect(normalizePriceUnit("/Month")).toBe("month");
    expect(normalizePriceUnit("/mo")).toBe("month");
    expect(normalizePriceUnit("/week")).toBe("week");
    expect(normalizePriceUnit("/hour")).toBe("hour");
    expect(normalizePriceUnit("/\\* year")).toBe("year");
  });

  it("returns null when no unit is present", () => {
    expect(normalizePriceUnit("")).toBeNull();
    expect(normalizePriceUnit(null)).toBeNull();
    expect(normalizePriceUnit("Quoted price (negotiable)")).toBeNull();
  });
});

describe("formatPricingHint", () => {
  it("canonicalises the amount and unit", () => {
    expect(formatPricingHint("20000", "month")).toBe("₹20,000/month");
    expect(formatPricingHint("5,999", "month")).toBe("₹5,999/month");
    expect(formatPricingHint("750", "day")).toBe("₹750/day");
  });

  it("refuses to invent a unit", () => {
    expect(formatPricingHint("6500", null)).toBeNull();
    expect(formatPricingHint("", "month")).toBeNull();
  });
});

describe("unitAfterAmount", () => {
  it("does not read a later price's unit when the window is exceeded", () => {
    const text = "₹5,999 ....................................... seat";
    expect(unitAfterAmount(text, "₹5,999".length)).toBeNull();
  });
});

describe("parseStoredPrice", () => {
  it("reads every legacy stored shape", () => {
    expect(parseStoredPrice("₹5999 /Month")).toMatchObject({
      amountInr: 5999,
      unit: "month",
      basis: "exact",
      monthlyInr: 5999,
    });
    expect(parseStoredPrice("₹ 6500/month")).toMatchObject({ amountInr: 6500, monthlyInr: 6500 });
    expect(parseStoredPrice("₹15,499/ desk / month")).toMatchObject({ monthlyInr: 15499 });
  });

  it("converts day and week rates to a monthly figure", () => {
    expect(parseStoredPrice("₹600/day")).toMatchObject({ unit: "day", monthlyInr: 13200 });
    expect(parseStoredPrice("₹3,000/week")).toMatchObject({ unit: "week", monthlyInr: 12900 });
  });

  it("records the from basis without changing the amount", () => {
    expect(parseStoredPrice("from ₹450/day")).toMatchObject({
      amountInr: 450,
      basis: "from",
      monthlyInr: 9900,
    });
  });

  it("gives no monthly figure for units that cannot be converted", () => {
    expect(parseStoredPrice("₹7,999/seat")).toMatchObject({ unit: "seat", monthlyInr: null });
    expect(parseStoredPrice("₹17,999/year")).toMatchObject({ unit: "year", monthlyInr: null });
  });

  it("returns null when the price is unusable", () => {
    expect(parseStoredPrice("₹10,000₹10,000")).toBeNull();
    expect(parseStoredPrice("₹6,500")).toBeNull();
    expect(parseStoredPrice(null)).toBeNull();
    expect(parseStoredPrice("Price on request")).toBeNull();
  });
});

describe("extractPricingHint", () => {
  it("reads the real source shapes", () => {
    expect(extractPricingHint("From ₹450 /pp/day")).toBe("₹450/day");
    expect(extractPricingHint("Starting₹5,999/\\* month")).toBe("₹5,999/month");
    expect(extractPricingHint("₹15,499/ desk / monthQuoted price (negotiable)")).toBe(
      "₹15,499/month",
    );
    expect(extractPricingHint("₹750/day")).toBe("₹750/day");
  });

  it("returns null for unit-less and absent prices", () => {
    expect(extractPricingHint("₹10,000₹10,000")).toBeNull();
    expect(extractPricingHint("₹6,500")).toBeNull();
    expect(extractPricingHint("Price on request")).toBeNull();
  });
});
