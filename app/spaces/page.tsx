import type { Metadata } from "next";
import { SpacesBrowseClient } from "@/components/spaces/SpacesBrowseClient";
import { isStaleSync } from "@/components/spaces/SpacesHeader";
import type { Listing, SyncRun } from "@/lib/listings/types";

export const metadata: Metadata = {
  title: "Spaces in Bangalore | Gentle Space",
  description:
    "Browse available coworking spaces and flexible offices in Bangalore.",
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
  const stale = isStaleSync(lastSync?.finishedAt);

  return (
    <SpacesBrowseClient initialListings={listings} lastSync={lastSync} stale={stale} />
  );
}
