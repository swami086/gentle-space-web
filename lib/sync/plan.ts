import type { DiscoveredListing } from "./sources/types";

export type ExistingListingSyncState = {
  sourceId: string;
  id: string;
  slug: string;
  syncedAt: Date;
  contentHash: string | null;
  embedHash: string | null;
  missingRuns: number;
};

export type SourceSyncPlan = {
  toScrape: DiscoveredListing[];
  toTouch: DiscoveredListing[];
};

export function planSourceSync(
  discovered: DiscoveredListing[],
  existing: ExistingListingSyncState[],
  now: Date,
  ttlMs: number,
  missingLimit: number,
): SourceSyncPlan {
  const bySourceId = new Map(existing.map((row) => [row.sourceId, row]));
  const uniqueDiscovered = [...new Map(discovered.map((row) => [row.sourceId, row])).values()];
  const toScrape: DiscoveredListing[] = [];
  const toTouch: DiscoveredListing[] = [];

  for (const listing of uniqueDiscovered) {
    const previous = bySourceId.get(listing.sourceId);
    const isStale = previous ? now.getTime() - previous.syncedAt.getTime() >= ttlMs : true;
    const needsScrape =
      !previous ||
      previous.contentHash == null ||
      previous.embedHash == null ||
      previous.missingRuns >= missingLimit ||
      isStale;

    if (needsScrape) {
      toScrape.push(listing);
    } else {
      toTouch.push(listing);
    }
  }

  return { toScrape, toTouch };
}
