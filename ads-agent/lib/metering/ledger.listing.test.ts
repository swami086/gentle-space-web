import { describe, expect, it } from "vitest";

import { listingUsageEntry } from "./ledger";

describe("listingUsageEntry", () => {
  it("returns a plain usage record without touching the database", () => {
    expect(
      listingUsageEntry({ orgId: "org-1", kind: "message", units: 3 }),
    ).toEqual({ orgId: "org-1", kind: "message", units: 3 });
  });

  it("supports platform_op kind", () => {
    expect(
      listingUsageEntry({ orgId: "org-2", kind: "platform_op", units: 1 }),
    ).toEqual({ orgId: "org-2", kind: "platform_op", units: 1 });
  });
});
