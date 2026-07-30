import { afterEach, describe, expect, it } from "vitest";
import { getListingDetailTtlMs, getListingMissingRunsLimit } from "./config";

afterEach(() => {
  delete process.env.LISTING_DETAIL_TTL_DAYS;
  delete process.env.LISTING_MISSING_RUNS_LIMIT;
});

describe("sync config", () => {
  it("uses safe defaults", () => {
    expect(getListingDetailTtlMs()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(getListingMissingRunsLimit()).toBe(3);
  });

  it("accepts positive integer overrides and rejects unsafe values", () => {
    process.env.LISTING_DETAIL_TTL_DAYS = "2";
    process.env.LISTING_MISSING_RUNS_LIMIT = "5";
    expect(getListingDetailTtlMs()).toBe(2 * 24 * 60 * 60 * 1000);
    expect(getListingMissingRunsLimit()).toBe(5);

    process.env.LISTING_DETAIL_TTL_DAYS = "0";
    expect(() => getListingDetailTtlMs()).toThrow(/LISTING_DETAIL_TTL_DAYS/);
  });
});
