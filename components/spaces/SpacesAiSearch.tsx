"use client";

import type { FormEvent } from "react";

type SpacesAiSearchProps = {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  interpretedQuery?: string | null;
  error?: string | null;
  loading?: boolean;
  compact?: boolean;
};

export function SpacesAiSearch({
  query,
  onQueryChange,
  onSubmit,
  onClear,
  interpretedQuery,
  error,
  loading = false,
  compact = false,
}: SpacesAiSearchProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <div className={compact ? undefined : "pb-6"}>
      <form onSubmit={handleSubmit}>
        <div className="flex h-14 min-w-0 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] pl-5 pr-2">
          {/* type=text: WebKit type=search draws a native clear (x) that steals clicks from Search.
              w-0 flex-1: long placeholder must not force the submit button off-screen. */}
          <input
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Ask AI — quiet cabin near Metro, under ₹15k…"
            className="relative z-0 min-w-0 w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
            aria-label="Search spaces with AI"
            disabled={loading}
            autoComplete="off"
            enterKeyHint="search"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="relative z-10 h-10 shrink-0 rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-50"
          >
            {loading ? "…" : "Search"}
          </button>
        </div>
        {compact ? null : (
          <p className="mt-2 text-xs text-[var(--muted)]">Natural language · ranked by meaning</p>
        )}
        {error ? (
          <p className="mt-2 text-sm text-[var(--accent-dark)]" role="alert">
            {error}
          </p>
        ) : null}
      </form>

      {interpretedQuery ? (
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--surface)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              AI understood
            </p>
            <p className="mt-1 text-sm text-[var(--ink)]">{interpretedQuery}</p>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 text-sm font-semibold text-[var(--accent)] hover:text-[var(--accent-dark)]"
          >
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}
