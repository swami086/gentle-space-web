export type ListingSource = "coworker" | "myhq" | "cofynd" | "gofloaters";

export type Listing = {
  id: string;
  source: ListingSource;
  sourceId: string;
  slug: string;
  title: string;
  description: string;
  shortTeaser: string;
  address: string;
  area: string;
  city: string;
  lat: number | null;
  lng: number | null;
  amenities: string[];
  images: string[];
  pricingHint: string | null;
  propertyType: string | null;
  sourceUrl: string;
  syncedAt: string; // ISO
};

export type SyncRunStatus = "success" | "failed";

export type SourceSyncOutcome = {
  status: "success" | "failed";
  discovered: number;
  scraped: number;
  inserted: number;
  updated: number;
  unchanged: number;
  hidden: number;
  error: string | null;
};

export type SyncRun = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: SyncRunStatus | "running";
  count: number | null;
  error: string | null;
  sources: Partial<Record<ListingSource, SourceSyncOutcome>>;
};

export const SOURCE_PRIORITY: Record<ListingSource, number> = {
  coworker: 4,
  myhq: 3,
  cofynd: 2,
  gofloaters: 1,
};
