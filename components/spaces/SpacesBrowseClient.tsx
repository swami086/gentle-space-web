"use client";

import { useCallback, useEffect, useState } from "react";
import { SpacesBrowseChrome } from "@/components/spaces/SpacesBrowseChrome";
import { SpaceCard } from "@/components/spaces/SpaceCard";
import { SpacesFiltersModal } from "@/components/spaces/SpacesFiltersModal";
import { SpacesHomeHero } from "@/components/spaces/SpacesHomeHero";
import { SpacesMap } from "@/components/spaces/SpacesMap";
import { SpacesEmpty } from "@/components/spaces/SpacesEmpty";
import { SpacesHeader } from "@/components/spaces/SpacesHeader";
import { SpacesStaleBanner } from "@/components/spaces/SpacesStaleBanner";
import {
  EMPTY_FILTERS,
  activeFilterChips,
  applySpacesFilters,
  type SpacesFilterState,
} from "@/lib/listings/filterListings";
import type { QueryEntities } from "@/lib/graph/types";
import type { Listing, SyncRun } from "@/lib/listings/types";

type MetaMode = "sync" | "matches" | "empty-search";

type SpacesBrowseClientProps = {
  initialListings: Listing[];
  lastSync: SyncRun | null;
  stale: boolean;
};

type SearchResponse = {
  interpretedQuery: string;
  listings: Listing[];
  matchedEntities?: QueryEntities;
};

export function SpacesBrowseClient({
  initialListings,
  lastSync,
  stale,
}: SpacesBrowseClientProps) {
  const [listings, setListings] = useState(initialListings);
  const [query, setQuery] = useState("");
  const [interpretedQuery, setInterpretedQuery] = useState<string | null>(null);
  const [searchEntities, setSearchEntities] = useState<QueryEntities | undefined>(undefined);
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [metaMode, setMetaMode] = useState<MetaMode>("sync");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filters, setFilters] = useState<SpacesFilterState>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showHome, setShowHome] = useState(true);

  const filtered = applySpacesFilters(listings, filters);
  const chips = activeFilterChips(filters);
  const featured = initialListings.slice(0, 4);
  const showHero = showHome && !interpretedQuery;
  const isCatalogEmpty = listings.length === 0 && metaMode === "sync";
  const isEmptyAiState = metaMode === "empty-search";
  const showEmptySplit = filtered.length === 0 && !isCatalogEmpty;

  const handleCardActivate = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const handlePinActivate = useCallback((id: string) => {
    setActiveId(id);
    const el = document.querySelector(`[data-listing-id="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const metaOverride =
    metaMode === "matches"
      ? `${filtered.length} match${filtered.length === 1 ? "" : "es"} · ranked by relevance`
      : metaMode === "empty-search"
        ? "0 matches"
        : undefined;

  const handleClear = useCallback(() => {
    setQuery("");
    setInterpretedQuery(null);
    setListings(initialListings);
    setActiveId(null);
    setFilters(EMPTY_FILTERS);
    setFiltersOpen(false);
    setMetaMode("sync");
    setError(null);
    setShowHome(true);
    setSearchEntities(undefined);
    setActiveQuery(null);
  }, [initialListings]);

  const restoreSyncCatalog = useCallback(() => {
    setListings(initialListings);
    setInterpretedQuery(null);
    setMetaMode("sync");
    setActiveId(null);
    setSearchEntities(undefined);
    setActiveQuery(null);
  }, [initialListings]);

  const runSearch = useCallback(async (rawQuery: string) => {
    const trimmed = rawQuery.trim();
    if (!trimmed) return;

    setError(null);
    setShowHome(false);
    setLoading(true);

    try {
      const response = await fetch("/api/spaces/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        restoreSyncCatalog();
        setError(
          body.error === "search unavailable"
            ? "AI search is unavailable right now."
            : "Search failed. Try again.",
        );
        return;
      }

      const data = (await response.json()) as SearchResponse;
      setQuery(trimmed);
      setInterpretedQuery(data.interpretedQuery);
      setSearchEntities(data.matchedEntities);
      setActiveQuery(trimmed);
      setListings(data.listings);
      setActiveId((prev) =>
        prev && data.listings.some((l) => l.id === prev) ? prev : null,
      );
      setMetaMode(data.listings.length === 0 ? "empty-search" : "matches");
    } catch {
      restoreSyncCatalog();
      setError("Search failed. Try again.");
    } finally {
      setLoading(false);
    }
  }, [restoreSyncCatalog]);

  const handleSearch = useCallback(async () => {
    await runSearch(query);
  }, [query, runSearch]);

  const handleRemoveChip = useCallback((chip: string) => {
    setFilters((current) => {
      if (current.deskTypes.includes(chip)) {
        return { ...current, deskTypes: current.deskTypes.filter((value) => value !== chip) };
      }
      if (current.areas.includes(chip)) {
        return { ...current, areas: current.areas.filter((value) => value !== chip) };
      }
      if (current.amenities.includes(chip)) {
        return { ...current, amenities: current.amenities.filter((value) => value !== chip) };
      }
      return current;
    });
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && interpretedQuery) {
        handleClear();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [interpretedQuery, handleClear]);

  useEffect(() => {
    if (activeId && !filtered.some((listing) => listing.id === activeId)) {
      setActiveId(null);
    }
  }, [activeId, filtered]);

  return (
    <>
      <SpacesHeader metaOverride={metaOverride} variant={showHero ? "minimal" : "default"} />
      {showHero ? (
        <SpacesHomeHero
          query={query}
          onQueryChange={setQuery}
          onSubmit={handleSearch}
          onClear={handleClear}
          error={error}
          loading={loading}
          featured={featured}
        />
      ) : (
        <SpacesBrowseChrome
          query={query}
          onQueryChange={setQuery}
          onSubmit={handleSearch}
          onClear={handleClear}
          interpretedQuery={interpretedQuery}
          error={error}
          loading={loading}
          filterChips={chips}
          onOpenFilters={() => setFiltersOpen(true)}
          onRemoveChip={handleRemoveChip}
        />
      )}
      {stale && lastSync?.finishedAt ? (
        <div className="mt-4">
          <SpacesStaleBanner lastSyncedAt={lastSync.finishedAt} />
        </div>
      ) : null}
      {isCatalogEmpty ? (
        <SpacesEmpty />
      ) : showEmptySplit ? (
        <section className="px-6 pb-16 pt-4 lg:px-[var(--page-pad-x)] lg:pb-20">
          {loading ? <p className="mb-4 text-sm text-[var(--muted)]">Searching...</p> : null}
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1 lg:w-[58%]">
              <div className="flex h-80 flex-col items-center justify-center gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-8 text-center">
                <p className="text-lg font-semibold text-[var(--ink)]">No spaces matched</p>
                <p className="max-w-md text-sm text-[var(--muted)]">
                  {isEmptyAiState
                    ? "Try broadening your ask, or Clear to see the full catalog."
                    : "Try adjusting your filters, or clear them to see more spaces."}
                </p>
              </div>
            </div>
            <div className="w-full lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)] lg:w-[42%] lg:shrink-0">
              <SpacesMap listings={[]} activeId={null} onActivate={() => {}} />
            </div>
          </div>
        </section>
      ) : (
        <section className="px-6 pb-16 pt-4 lg:px-[var(--page-pad-x)] lg:pb-20">
          {loading ? <p className="mb-4 text-sm text-[var(--muted)]">Searching...</p> : null}
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1 lg:w-[58%]">
              <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-2">
                {filtered.map((listing) => (
                  <li key={listing.id}>
                    <SpaceCard
                      listing={listing}
                      active={listing.id === activeId}
                      onActivate={handleCardActivate}
                      searchQuery={activeQuery ?? undefined}
                      searchEntities={searchEntities}
                    />
                  </li>
                ))}
              </ul>
            </div>
            <div className="w-full lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)] lg:w-[42%] lg:shrink-0">
              <SpacesMap
                listings={filtered}
                activeId={activeId}
                onActivate={handlePinActivate}
              />
            </div>
          </div>
        </section>
      )}
      <SpacesFiltersModal
        open={filtersOpen}
        listings={listings}
        value={filters}
        onChange={setFilters}
        onClose={() => setFiltersOpen(false)}
        onClear={handleClearFilters}
        resultCount={filtered.length}
      />
    </>
  );
}
