import Link from "next/link";
import type { Listing, ListingSource } from "@/lib/listings/types";
import { spaceListingUrl } from "@/lib/site";
import { LikeSpaceButton } from "./LikeSpaceButton";

const SOURCE_LABELS: Record<ListingSource, string> = {
  coworker: "Coworker",
  myhq: "myHQ",
  cofynd: "CoFynd",
  gofloaters: "GoFloaters",
};

type SpaceCardProps = {
  listing: Listing;
  active?: boolean;
  onActivate?: (id: string) => void;
};

export function SpaceCard({ listing, active = false, onActivate }: SpaceCardProps) {
  const heroImage = listing.images[0];
  const detailUrl = `/spaces/${listing.slug}`;
  const propertyUrl = spaceListingUrl(listing.slug);

  return (
    <article
      data-listing-id={listing.id}
      data-active={active ? "true" : "false"}
      onMouseEnter={() => onActivate?.(listing.id)}
      onFocusCapture={() => onActivate?.(listing.id)}
      className={`flex flex-col overflow-hidden rounded-[var(--radius-md)] border bg-[var(--bg)] transition ${
        active
          ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/30"
          : "border-[var(--border)]"
      }`}
    >
      <Link href={detailUrl} className="group block">
        <div className="relative flex h-[180px] items-center justify-center bg-[var(--surface-tint)]">
          {heroImage ? (
            // ponytail: plain img for hotlinked source URLs; Next/Image remotePatterns not configured for all hosts yet
            <img
              src={heroImage}
              alt=""
              className="h-full w-full object-cover transition group-hover:opacity-95"
              loading="lazy"
            />
          ) : (
            <span className="text-sm text-[var(--muted)]">Photo</span>
          )}
        </div>
      </Link>

      <div className="flex flex-col gap-2 px-[18px] pb-[18px] pt-4">
        <div className="flex items-start justify-between gap-2">
          <Link href={detailUrl} className="min-w-0 flex-1 group">
            <h2 className="text-[17px] font-semibold leading-snug text-[var(--ink)] transition group-hover:text-[var(--accent-dark)]">
              {listing.title}
            </h2>
            {listing.area ? (
              <p className="mt-1 text-[13px] text-[var(--ink-secondary)]">{listing.area}</p>
            ) : null}
          </Link>
          <LikeSpaceButton
            propertyName={listing.title}
            propertyUrl={propertyUrl}
            variant="pill"
          />
        </div>

        {listing.shortTeaser ? (
          <p className="text-sm leading-[1.45] text-[var(--muted)]">{listing.shortTeaser}</p>
        ) : null}

        <span className="inline-flex w-fit rounded-full bg-[var(--surface-tint)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink-secondary)]">
          {SOURCE_LABELS[listing.source]}
        </span>
      </div>
    </article>
  );
}
