import { fullReplaceListings } from "../db/listings";
import { embedAllListings } from "./embed-listings";
import { finishSyncRun, startSyncRun } from "../db/sync-runs";
import { rebuildListingGraph } from "../graph/rebuild";
import { dedupeListings } from "../listings/dedupe";
import { slugifyTitle } from "../listings/slug";
import type { Listing, SyncRun } from "../listings/types";
import {
  cofyndAdapter,
  coworkerAdapter,
  gofloatersAdapter,
  myhqAdapter,
} from "./sources";
import type { RawListing } from "./sources/types";

export async function runListingsSync(): Promise<SyncRun> {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await startSyncRun(runId);

  const results = await Promise.allSettled([
    coworkerAdapter.fetchAll(),
    myhqAdapter.fetchAll(),
    cofyndAdapter.fetchAll(),
    gofloatersAdapter.fetchAll(),
  ]);

  const raw: RawListing[] = [];
  let sourcesOk = 0;

  for (const r of results) {
    if (r.status === "fulfilled" && r.value.length) {
      sourcesOk++;
      raw.push(...r.value);
    }
  }

  if (sourcesOk < 1 || raw.length < 10) {
    const error = `abort: sourcesOk=${sourcesOk} count=${raw.length}`;
    await finishSyncRun(runId, "failed", null, error);
    return {
      id: runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "failed",
      count: null,
      error,
    };
  }

  const syncedAt = new Date().toISOString();
  const mapped: Listing[] = raw.map((r) => ({
    ...r,
    id: crypto.randomUUID(),
    slug: slugifyTitle(r.title, r.sourceId),
    syncedAt,
  }));
  const deduped = dedupeListings(mapped);

  await fullReplaceListings(deduped);
  await finishSyncRun(runId, "success", deduped.length, null);

  if (process.env.AI_PROVIDER === "vertex" || process.env.OPENAI_API_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      await embedAllListings();
    } catch (err) {
      console.error("embed failed:", err);
    }

    try {
      await rebuildListingGraph();
    } catch (err) {
      console.error("graph rebuild failed:", err);
    }
  }

  return {
    id: runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: "success",
    count: deduped.length,
    error: null,
  };
}
