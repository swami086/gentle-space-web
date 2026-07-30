import type { Metadata } from "next";
import { SpacesBrowseClient } from "@/components/spaces/SpacesBrowseClient";
import { isStaleSync } from "@/components/spaces/SpacesHeader";
import type { Listing, SyncRun } from "@/lib/listings/types";

export const metadata: Metadata = {
  title: "Spaces in Bangalore | Gentle Space",
  description:
    "Browse coworking spaces and flexible offices in Bangalore, synced daily from trusted directories.",
};

async function loadSpacesData(): Promise<{ listings: Listing[]; lastSync: SyncRun | null }> {
  try {
    const [{ listListings }, { getLatestSuccessfulSync }] = await Promise.all([
      import("@/lib/db/listings"),
      import("@/lib/db/sync-runs"),
    ]);
    const [listings, lastSync] = await Promise.all([listListings(), getLatestSuccessfulSync()]);
    return { listings, lastSync };
  } catch {
    return { listings: [], lastSync: null };
  }
}

export default async function SpacesPage() {
  const { listings, lastSync } = await loadSpacesData();
  const sourceCount = new Set(listings.map((listing) => listing.source)).size;
  const stale = isStaleSync(lastSync?.finishedAt);

  return (
    <SpacesBrowseClient
      initialListings={listings}
      lastSync={lastSync}
      sourceCount={sourceCount}
      stale={stale}
    />
  );
}
