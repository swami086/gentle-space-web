import { describe, expect, it } from "vitest";
import { planSourceSync, type ExistingListingSyncState } from "./plan";

const now = new Date("2026-07-30T00:00:00.000Z");

const discovered = [
  { sourceId: "fresh", url: "https://example.com/fresh" },
  { sourceId: "stale", url: "https://example.com/stale" },
  { sourceId: "new", url: "https://example.com/new" },
  { sourceId: "hidden", url: "https://example.com/hidden" },
  { sourceId: "unknown", url: "https://example.com/unknown" },
];

const existing: ExistingListingSyncState[] = [
  {
    sourceId: "fresh",
    id: "id-fresh",
    slug: "fresh",
    syncedAt: new Date("2026-07-29T00:00:00.000Z"),
    contentHash: "content",
    embedHash: "embed",
    missingRuns: 0,
  },
  {
    sourceId: "stale",
    id: "id-stale",
    slug: "stale",
    syncedAt: new Date("2026-07-01T00:00:00.000Z"),
    contentHash: "content",
    embedHash: "embed",
    missingRuns: 0,
  },
  {
    sourceId: "hidden",
    id: "id-hidden",
    slug: "hidden",
    syncedAt: new Date("2026-07-29T00:00:00.000Z"),
    contentHash: "content",
    embedHash: "embed",
    missingRuns: 3,
  },
  {
    sourceId: "unknown",
    id: "id-unknown",
    slug: "unknown",
    syncedAt: new Date("2026-07-29T00:00:00.000Z"),
    contentHash: null,
    embedHash: "embed",
    missingRuns: 0,
  },
];

describe("planSourceSync", () => {
  it("scrapes new, stale, unknown-hash, and reactivated listings only", () => {
    const plan = planSourceSync(discovered, existing, now, 7 * 86_400_000, 3);

    expect(plan.toScrape.map((item) => item.sourceId)).toEqual([
      "stale",
      "new",
      "hidden",
      "unknown",
    ]);
    expect(plan.toTouch.map((item) => item.sourceId)).toEqual(["fresh"]);
  });

  it("does not mutate an empty discovery result", () => {
    expect(planSourceSync([], existing, now, 7 * 86_400_000, 3)).toEqual({
      toScrape: [],
      toTouch: [],
    });
  });
});
