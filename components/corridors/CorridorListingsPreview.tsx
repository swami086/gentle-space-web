"use client";

import { useLeadCapture } from "@/components/LeadCaptureContext";
import { Reveal } from "@/components/motion/Reveal";
import { SpaceCard } from "@/components/spaces/SpaceCard";
import type { PublicListing } from "@/lib/listings/public";

export function CorridorListingsPreview({
  listings,
  corridorName,
}: {
  listings: PublicListing[];
  corridorName: string;
}) {
  const { openModal } = useLeadCapture();
  const searchHref = `/spaces?area=${encodeURIComponent(corridorName)}`;
  const hasListings = listings.length > 0;

  return (
    <section className="bg-[var(--bg)]">
      <Reveal className="mx-auto max-w-[1120px] px-5 py-12 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-[clamp(20px,2.4vw,26px)] font-semibold leading-[1.25] text-[var(--ink)]">
            Available in {corridorName} right now
          </h2>
          {hasListings ? (
            <a
              href={searchHref}
              className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-[var(--accent-dark)] transition hover:text-[var(--accent)]"
            >
              See all {corridorName} spaces
              <span aria-hidden="true">→</span>
            </a>
          ) : null}
        </div>

        {hasListings ? (
          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <li key={listing.id}>
                <SpaceCard listing={listing} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-5 flex flex-col items-start gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6">
            <p className="text-[15px] font-medium text-[var(--ink)]">
              No live {corridorName} listings this week.
            </p>
            <p className="max-w-[52ch] text-[14px] leading-[1.6] text-[var(--muted)]">
              Share your brief and we&apos;ll source {corridorName} options that fit
              your size, budget, and timeline.
            </p>
            <button
              type="button"
              onClick={openModal}
              className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-6 py-3 text-[15px] font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-dark)]"
            >
              Share your brief
            </button>
          </div>
        )}
      </Reveal>
    </section>
  );
}
