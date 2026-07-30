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

export type SyncRun = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: SyncRunStatus | "running";
  count: number | null;
  error: string | null;
};

export const SOURCE_PRIORITY: Record<ListingSource, number> = {
  coworker: 4,
  myhq: 3,
  cofynd: 2,
  gofloaters: 1,
};
