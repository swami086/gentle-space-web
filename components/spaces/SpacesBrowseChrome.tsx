"use client";

import { SpacesAiSearch } from "@/components/spaces/SpacesAiSearch";

type SpacesBrowseChromeProps = {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  interpretedQuery?: string | null;
  loading?: boolean;
  error?: string | null;
  filterChips: string[];
  onOpenFilters: () => void;
  onRemoveChip?: (chip: string) => void;
};

export function SpacesBrowseChrome({
  query,
  onQueryChange,
  onSubmit,
  onClear,
  interpretedQuery,
  loading = false,
  error,
  filterChips,
  onOpenFilters,
  onRemoveChip,
}: SpacesBrowseChromeProps) {
  return (
    <section className="sticky top-[92px] z-30 border-b border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur">
      <div className="px-6 py-4 lg:px-12">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              <SpacesAiSearch
                query={query}
                onQueryChange={onQueryChange}
                onSubmit={onSubmit}
                onClear={onClear}
                interpretedQuery={interpretedQuery}
                error={error}
                loading={loading}
                compact
              />
            </div>
            <button
              type="button"
              onClick={onOpenFilters}
              className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-[13px] font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:bg-[var(--surface)]"
            >
              Filters
            </button>
          </div>

          {filterChips.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {filterChips.map((chip) =>
                onRemoveChip ? (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => onRemoveChip(chip)}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-[13px] font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:bg-[var(--surface)]"
                    aria-label={`Remove ${chip} filter`}
                  >
                    <span>{chip}</span>
                    <span aria-hidden="true" className="text-[var(--muted)]">
                      ×
                    </span>
                  </button>
                ) : (
                  <span
                    key={chip}
                    className="inline-flex rounded-full border border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-[13px] font-medium text-[var(--ink)]"
                  >
                    {chip}
                  </span>
                ),
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
