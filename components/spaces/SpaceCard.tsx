import Link from "next/link";
import { emptyQueryEntities, type QueryEntities } from "@/lib/graph/types";
import { displayLocationLine } from "@/lib/listings/redact";
import type { PublicListing } from "@/lib/listings/public";
import type { ListingSource } from "@/lib/listings/types";
import { entitySignature } from "@/lib/spaces/entity-signature";
import { spaceListingUrl } from "@/lib/site";
import { LikeSpaceButton } from "./LikeSpaceButton";
import { SpaceInsightPanel } from "./SpaceInsightPanel";

function insightPanelKey(listingId: string, query: string, entities?: QueryEntities): string {
  return `${listingId}:${query}:${entitySignature(entities ?? emptyQueryEntities())}`;
}

const SOURCE_LABELS: Record<ListingSource, string> = {
  coworker: "Coworker",
  myhq: "myHQ",
  cofynd: "CoFynd",
  gofloaters: "GoFloaters",
};

type SpaceCardProps = {
  listing: PublicListing;
  active?: boolean;
  onActivate?: (id: string) => void;
  searchQuery?: string;
  searchEntities?: QueryEntities;
};

export function SpaceCard({
  listing,
  active = false,
  onActivate,
  searchQuery,
  searchEntities,
}: SpaceCardProps) {
  const heroImage = listing.images[0];
  const detailUrl = `/spaces/${listing.slug}`;
  const propertyUrl = spaceListingUrl(listing.slug);

  return (
    <article
      data-listing-id={listing.id}
      data-active={active ? "true" : "false"}
      onMouseEnter={() => onActivate?.(listing.id)}
      onFocusCapture={() => onActivate?.(listing.id)}
      className={`group flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] transition duration-200 ${
        active
          ? "border-[var(--accent)] bg-[var(--bg)] shadow-[0_10px_30px_rgba(32,24,48,0.08)]"
          : "hover:-translate-y-0.5 hover:border-[var(--accent)]/45 hover:shadow-[0_10px_24px_rgba(32,24,48,0.05)]"
      }`}
    >
      <Link href={detailUrl} className="block">
        <div className="relative flex h-[164px] items-center justify-center overflow-hidden bg-[var(--bg)]">
          {heroImage ? (
            // ponytail: plain img for hotlinked source URLs; Next/Image remotePatterns not configured for all hosts yet
            <img
              src={heroImage}
              alt=""
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.01] group-hover:opacity-95"
              loading="lazy"
            />
          ) : (
            <span className="text-sm text-[var(--muted)]">Photo</span>
          )}
        </div>
      </Link>

      <div className="flex flex-col gap-3 px-4 pb-4 pt-3.5">
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex w-fit rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            {SOURCE_LABELS[listing.source]}
          </span>
          <LikeSpaceButton
            propertyName={listing.title}
            propertyUrl={propertyUrl}
            variant="pill"
          />
        </div>

        <Link href={detailUrl} className="min-w-0">
          <div className="space-y-1.5">
            <h2 className="font-display text-[18px] font-semibold leading-[1.2] text-[var(--ink)] transition group-hover:text-[var(--accent-dark)]">
              {listing.title}
            </h2>
            {listing.area || listing.city ? (
              <p className="text-[13px] text-[var(--ink-secondary)]">
                {displayLocationLine(listing.area, listing.city)}
              </p>
            ) : null}
          </div>
        </Link>

        {listing.shortTeaser ? (
          <p className="text-[13px] leading-[1.5] text-[var(--muted)]">{listing.shortTeaser}</p>
        ) : null}

        {searchQuery ? (
          <div className="border-t border-[var(--border)] pt-3">
            <SpaceInsightPanel
              key={insightPanelKey(listing.id, searchQuery, searchEntities)}
              listingId={listing.id}
              query={searchQuery}
              entities={searchEntities}
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}
