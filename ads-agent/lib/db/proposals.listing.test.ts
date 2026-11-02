import { describe, expect, it } from "vitest";

import { assertListingCreatePayload, buildListingCreateProposal } from "./proposals";

const matchingPayload = {
  traceId: "trace-abc",
  ceilings: [
    { platform: "meta" as const, ceilingMinor: 30_000 },
    { platform: "google" as const, ceilingMinor: 20_000 },
  ],
  shares: [
    { platform: "meta" as const, budgetMinor: 30_000 },
    { platform: "google" as const, budgetMinor: 20_000 },
  ],
};

describe("assertListingCreatePayload", () => {
  it("accepts shares whose per-platform totals match ceilings", () => {
    expect(assertListingCreatePayload(matchingPayload)).toEqual(matchingPayload);
  });

  it("rejects when share totals do not match a platform ceiling", () => {
    expect(() =>
      assertListingCreatePayload({
        ...matchingPayload,
        shares: [{ platform: "meta", budgetMinor: 5_000 }],
      }),
    ).toThrow(/share total for meta is 5000, ceiling is 30000/);
  });

  it("rejects a second share on the same platform", () => {
    expect(() =>
      assertListingCreatePayload({
        ...matchingPayload,
        shares: [
          { platform: "meta", budgetMinor: 10_000 },
          { platform: "meta", budgetMinor: 20_000 },
        ],
      }),
    ).toThrow(/more than one meta share/);
  });

  it("rejects Google on a residential listing", () => {
    expect(() =>
      assertListingCreatePayload({
        ...matchingPayload,
        sector: "residential",
      }),
    ).toThrow(/residential listings are Meta only/);
  });

  it("rejects an empty traceId", () => {
    expect(() =>
      assertListingCreatePayload({
        ...matchingPayload,
        traceId: "   ",
      }),
    ).toThrow(/traceId must be non-empty/);
  });
});

describe("buildListingCreateProposal", () => {
  it("returns a create_campaign proposal with validated payload", () => {
    const proposal = buildListingCreateProposal({
      ...matchingPayload,
      triggeredRule: "listing_create",
      rationale: "Pilot listing approved.",
    });
    expect(proposal).toEqual({
      kind: "create_campaign",
      campaignId: null,
      triggeredRule: "listing_create",
      rationale: "Pilot listing approved.",
      payload: matchingPayload,
    });
  });
});
