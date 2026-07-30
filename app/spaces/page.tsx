import type { Metadata } from "next";
import { SpacesBrowseClient } from "@/components/spaces/SpacesBrowseClient";
import { isStaleSync } from "@/components/spaces/SpacesHeader";
import type { PublicListing } from "@/lib/listings/public";
import { toPublicListing } from "@/lib/listings/public";
import type { SyncRun } from "@/lib/listings/types";

export const metadata: Metadata = {
  title: "Spaces in Bangalore | Gentle Space",
  description:
    "Browse available coworking spaces and flexible offices in Bangalore.",
};

async function loadSpacesData(): Promise<{ listings: PublicListing[]; lastSync: SyncRun | null }> {
  try {
    const [{ listListings }, { getLatestSuccessfulSync }] = await Promise.all([
      import("@/lib/db/listings"),
      import("@/lib/db/sync-runs"),
    ]);
    const [rows, lastSync] = await Promise.all([listListings(), getLatestSuccessfulSync()]);
    return { listings: rows.map(toPublicListing), lastSync };
  } catch {
    return { listings: [], lastSync: null };
  }
}

export default async function SpacesPage() {
  const { listings, lastSync } = await loadSpacesData();
  const stale = isStaleSync(lastSync?.finishedAt);

  return (
    <SpacesBrowseClient initialListings={listings} lastSync={lastSync} stale={stale} />
  );
}
