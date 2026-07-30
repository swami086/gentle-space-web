import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getListingDetailTtlMs, getListingMissingRunsLimit } from "./config";

let originalDetailTtlDays: string | undefined;
let originalMissingRunsLimit: string | undefined;

beforeEach(() => {
  originalDetailTtlDays = process.env.LISTING_DETAIL_TTL_DAYS;
  originalMissingRunsLimit = process.env.LISTING_MISSING_RUNS_LIMIT;
});

afterEach(() => {
  if (originalDetailTtlDays === undefined) {
    delete process.env.LISTING_DETAIL_TTL_DAYS;
  } else {
    process.env.LISTING_DETAIL_TTL_DAYS = originalDetailTtlDays;
  }

  if (originalMissingRunsLimit === undefined) {
    delete process.env.LISTING_MISSING_RUNS_LIMIT;
  } else {
    process.env.LISTING_MISSING_RUNS_LIMIT = originalMissingRunsLimit;
  }
});

describe("sync config", () => {
  it("uses safe defaults", () => {
    delete process.env.LISTING_DETAIL_TTL_DAYS;
    delete process.env.LISTING_MISSING_RUNS_LIMIT;

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

    process.env.LISTING_DETAIL_TTL_DAYS = "2";
    process.env.LISTING_MISSING_RUNS_LIMIT = "0";
    expect(() => getListingMissingRunsLimit()).toThrow(/LISTING_MISSING_RUNS_LIMIT/);
  });
});
