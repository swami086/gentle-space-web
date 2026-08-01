"use client";

import { SpaceCard } from "@/components/spaces/SpaceCard";
import { SpacesAiSearch } from "@/components/spaces/SpacesAiSearch";
import type { PublicListing } from "@/lib/listings/public";

type SpacesHomeHeroProps = {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  loading?: boolean;
  error?: string | null;
  featured: PublicListing[];
};

export function SpacesHomeHero({
  query,
  onQueryChange,
  onSubmit,
  onClear,
  loading = false,
  error,
  featured,
}: SpacesHomeHeroProps) {
  const featuredListings = featured.slice(0, 4);

  return (
    <section className="border-b border-[var(--border)] bg-[var(--bg)]">
      <div className="px-5 py-12 lg:px-[var(--page-pad-x)] lg:py-16">
        <div className="mx-auto flex max-w-[760px] flex-col items-center text-center">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
            Spaces · Bangalore
          </p>
          <h1 className="font-display mt-4 text-[clamp(32px,4vw,48px)] font-semibold leading-[1.08] tracking-tight text-[var(--ink)]">
            Find a workspace that fits how you work
          </h1>
          <div className="mt-8 w-full rounded-[calc(var(--radius)+2px)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[0_1px_0_rgba(0,0,0,0.02)] lg:p-4">
            <SpacesAiSearch
              query={query}
              onQueryChange={onQueryChange}
              onSubmit={onSubmit}
              onClear={onClear}
              error={error}
              loading={loading}
            />
          </div>
        </div>
      </div>

      {featuredListings.length > 0 ? (
        <div className="px-5 pb-14 pt-10 lg:px-[var(--page-pad-x)] lg:pb-20 lg:pt-12">
          <div className="rounded-[calc(var(--radius)+2px)] border border-[var(--border)] bg-[var(--surface)] px-4 py-5 lg:px-6 lg:py-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-[clamp(22px,2.4vw,28px)] font-semibold leading-[1.2] tracking-tight text-[var(--ink)]">
                  Featured spaces
                </h2>
                <p className="mt-1 text-[14px] leading-[1.5] text-[var(--muted)]">
                  A few strong starting points across Bangalore.
                </p>
              </div>
            </div>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {featuredListings.map((listing) => (
                <li key={listing.id}>
                  <SpaceCard listing={listing} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
