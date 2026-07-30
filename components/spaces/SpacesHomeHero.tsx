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
    <section className="bg-[var(--bg)]">
      <div className="px-6 pb-8 pt-10 lg:px-[var(--page-pad-x)] lg:pb-10 lg:pt-14">
        <div className="mx-auto flex max-w-[720px] flex-col items-center text-center">
          <p className="text-sm font-semibold text-[var(--accent)]">Spaces · Bangalore</p>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-[var(--ink)] lg:text-[40px]">
            Find a workspace that fits how you work
          </h1>
          <div className="mt-7 w-full">
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
        <div className="px-6 pb-16 lg:px-[var(--page-pad-x)] lg:pb-20">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-[var(--ink)]">
                Featured spaces
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                A few strong starting points across Bangalore.
              </p>
            </div>
          </div>
          <ul className="mt-5 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {featuredListings.map((listing) => (
              <li key={listing.id}>
                <SpaceCard listing={listing} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
