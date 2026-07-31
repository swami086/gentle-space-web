import {
  applySourceSync,
  countVisibleListings,
  listExistingForSource,
} from "../db/listings";
import { finishSyncRun, startSyncRun } from "../db/sync-runs";
import { syncListingGraph } from "../graph/rebuild";
import { slugifyTitle } from "../listings/slug";
import type { Listing, SourceSyncOutcome, SyncRun } from "../listings/types";
import { mapSettledWithConcurrency } from "./concurrency";
import { contentHash, embedHash } from "./content-hash";
import { getListingDetailTtlMs, getListingMissingRunsLimit } from "./config";
import { embedListingsMissingEmbedding } from "./embed-listings";
import { geocodeListingsMissingCoords } from "./geocode-listings";
import { enrichListings } from "./enrich-listings";
import { planSourceSync } from "./plan";
import {
  cofyndAdapter,
  coworkerAdapter,
  gofloatersAdapter,
  myhqAdapter,
} from "./sources";
import type { SourceAdapter } from "./sources/types";

export type RunListingsSyncOptions = {
  adapters?: SourceAdapter[];
  maxDetailScrapes?: number;
  trackMissing?: boolean;
  skipDownstream?: boolean;
  now?: Date;
  ttlMs?: number;
};

type SourceRunResult = {
  outcome: SourceSyncOutcome;
  graphListings: Listing[];
  newlyHiddenIds: string[];
};

const DEFAULT_ADAPTERS: SourceAdapter[] = [
  coworkerAdapter,
  myhqAdapter,
  cofyndAdapter,
  gofloatersAdapter,
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failureOutcome(
  error: unknown,
  discovered: number,
): SourceSyncOutcome {
  return {
    status: "failed",
    discovered,
    scraped: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    hidden: 0,
    error: errorMessage(error),
  };
}

async function runSourceSync(
  adapter: SourceAdapter,
  options: Required<Pick<RunListingsSyncOptions, "now" | "ttlMs" | "trackMissing">> &
    Pick<RunListingsSyncOptions, "maxDetailScrapes">,
): Promise<SourceRunResult> {
  let discoveredCount = 0;

  try {
    const discovered = await adapter.discover();
    discoveredCount = discovered.length;

    if (discovered.length === 0) {
      throw new Error(`${adapter.source} discovered zero URLs`);
    }

    const existing = await listExistingForSource(adapter.source);
    const missingLimit = getListingMissingRunsLimit();
    const plan = planSourceSync(
      discovered,
      existing,
      options.now,
      options.ttlMs,
      missingLimit,
    );
    const plannedScrapes =
      options.maxDetailScrapes == null
        ? plan.toScrape
        : plan.toScrape.slice(0, options.maxDetailScrapes);
    const settled = await mapSettledWithConcurrency(
      plannedScrapes,
      3,
      (item) => adapter.fetchDetail(item.url),
    );
    const existingById = new Map(existing.map((row) => [row.sourceId, row]));
    const scraped = settled.flatMap((result, index) => {
      if (result.status !== "fulfilled" || result.value == null) {
        return [];
      }

      const raw = result.value;
      const discoveredRow = plannedScrapes[index];
      if (
        raw.source !== adapter.source ||
        raw.sourceId !== discoveredRow.sourceId
      ) {
        return [];
      }

      const previous = existingById.get(raw.sourceId);
      // ponytail: slug suffix must be the listing's own UUID, not a truncated
      // sourceId — many source URLs share a common area/city prefix in their
      // first 12 chars, which previously caused unrelated listings to collide
      // on `listings_slug_key` and roll back the entire source's sync batch.
      const id = previous?.id ?? crypto.randomUUID();
      const listing: Listing = {
        ...raw,
        id,
        slug: previous?.slug ?? slugifyTitle(raw.title, id),
        syncedAt: options.now.toISOString(),
      };

      return [
        {
          listing,
          contentHash: contentHash(raw),
          embedHash: embedHash(raw),
          isNew: previous == null,
          previousContentHash: previous?.contentHash ?? null,
          previousEmbedHash: previous?.embedHash ?? null,
          wasHidden: (previous?.missingRuns ?? 0) >= missingLimit,
        },
      ];
    });

    const write = await applySourceSync({
      source: adapter.source,
      discoveredSourceIds: discovered.map((row) => row.sourceId),
      scraped,
      missingLimit,
      trackMissing: options.trackMissing,
    });

    return {
      outcome: {
        status: "success",
        discovered: discovered.length,
        scraped: scraped.length,
        inserted: write.inserted,
        updated: write.updated,
        unchanged: write.unchanged,
        hidden: write.newlyHiddenIds.length,
        error: null,
      },
      graphListings: write.graphListings,
      newlyHiddenIds: write.newlyHiddenIds,
    };
  } catch (error) {
    return {
      outcome: failureOutcome(error, discoveredCount),
      graphListings: [],
      newlyHiddenIds: [],
    };
  }
}

export async function runListingsSync(
  options: RunListingsSyncOptions = {},
): Promise<SyncRun> {
  const adapters = options.adapters ?? DEFAULT_ADAPTERS;
  const trackMissing = options.trackMissing ?? true;
  const skipDownstream = options.skipDownstream ?? false;
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? getListingDetailTtlMs();
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  let finishedAt: string | null = null;
  let status: SyncRun["status"] = "running";
  let count: number | null = null;
  let error: string | null = null;
  const sources: SyncRun["sources"] = {};
  let started = false;

  try {
    await startSyncRun(runId);
    started = true;

    const graphListings: Listing[] = [];
    const newlyHiddenIds: string[] = [];

    for (const adapter of adapters) {
      const result = await runSourceSync(adapter, {
        now,
        ttlMs,
        trackMissing,
        maxDetailScrapes: options.maxDetailScrapes,
      });
      sources[adapter.source] = result.outcome;
      graphListings.push(...result.graphListings);
      newlyHiddenIds.push(...result.newlyHiddenIds);
    }

    const anySuccess = Object.values(sources).some(
      (source) => source?.status === "success",
    );

    if (anySuccess && !skipDownstream) {
      try {
        await enrichListings();
      } catch (downstreamError) {
        console.error("enrichment sync failed:", downstreamError);
      }

      try {
        await embedListingsMissingEmbedding();
      } catch (downstreamError) {
        console.error("embedding sync failed:", downstreamError);
      }

      try {
        await geocodeListingsMissingCoords();
      } catch (downstreamError) {
        console.error("geocode sync failed:", downstreamError);
      }

      try {
        // ponytail: Task 5 keeps the downstream hook thin; Task 6 makes it truly incremental.
        await syncListingGraph(graphListings);
      } catch (downstreamError) {
        console.error("graph sync failed:", downstreamError);
      }
    }

    void newlyHiddenIds;
    count = await countVisibleListings();
    status = anySuccess ? "success" : "failed";
    error = anySuccess ? null : "all sources failed";
  } catch (runError) {
    status = "failed";
    count = null;
    error = errorMessage(runError);
  } finally {
    finishedAt = new Date().toISOString();
    if (started) {
      await finishSyncRun(runId, status === "success" ? "success" : "failed", count, error, sources);
    }
  }

  return {
    id: runId,
    startedAt,
    finishedAt,
    status,
    count,
    error,
    sources,
  };
}
