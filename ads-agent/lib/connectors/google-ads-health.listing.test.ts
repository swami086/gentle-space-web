import { describe, expect, it } from "vitest";

import { listingSharesHealthy } from "./google-ads-health";

describe("listingSharesHealthy", () => {
  it("is false when there are no reads", () => {
    expect(listingSharesHealthy([])).toBe(false);
  });

  it("is true when every share is readable", () => {
    expect(
      listingSharesHealthy([
        { shareId: "a", readable: true },
        { shareId: "b", readable: true },
      ]),
    ).toBe(true);
  });

  it("is false when any share is not readable", () => {
    expect(
      listingSharesHealthy([
        { shareId: "a", readable: true },
        { shareId: "b", readable: false },
      ]),
    ).toBe(false);
  });
});
