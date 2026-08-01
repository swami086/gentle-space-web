import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApproxAreaMap } from "@/components/spaces/ApproxAreaMap";
import { LikeSpaceButton } from "@/components/spaces/LikeSpaceButton";
import { SpaceGallery } from "@/components/spaces/SpaceGallery";
import { getListingBySlug } from "@/lib/db/listings";
import { toPublicListing } from "@/lib/listings/public";
import { displayLocationLine, redactSensitiveText } from "@/lib/listings/redact";
import { spaceListingUrl } from "@/lib/site";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);
  if (!listing) return { title: "Space not found | Gentle Space" };

  const teaser = redactSensitiveText(listing.shortTeaser || listing.description);
  return {
    title: `${listing.title} | Gentle Space`,
    description: teaser.slice(0, 160),
  };
}

export default async function SpaceDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const raw = await getListingBySlug(slug);
  if (!raw) notFound();

  const listing = toPublicListing(raw);
  const locationLine = displayLocationLine(listing.area, listing.city);
  const propertyUrl = spaceListingUrl(listing.slug);

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg)]">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-5 py-7 lg:px-[var(--page-pad-x)] lg:pb-14 lg:pt-7">
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
          <SpaceGallery title={listing.title} images={listing.images} />
        </div>

        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-7">
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 lg:p-6">
              <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] pb-4">
                <div className="min-w-0 flex-1">
                  <h1 className="font-display text-[clamp(24px,3vw,32px)] font-semibold leading-[1.2] text-[var(--ink)]">
                    {listing.title}
                  </h1>
                  <p className="mt-2 text-[13px] font-medium text-[var(--ink-secondary)]">
                    {locationLine}
                  </p>
                </div>
                <LikeSpaceButton
                  variant="pill"
                  propertyName={listing.title}
                  propertyUrl={propertyUrl}
                />
              </div>

              {listing.shortTeaser ? (
                <p className="max-w-[60ch] text-[15px] font-medium leading-[1.6] text-[var(--ink)]">
                  {listing.shortTeaser}
                </p>
              ) : null}

              {listing.description ? (
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] px-4 py-3.5">
                  <p className="whitespace-pre-line text-[14px] leading-[1.7] text-[var(--muted)]">
                    {listing.description}
                  </p>
                </div>
              ) : null}

              {listing.amenities.length > 0 ? (
                <div className="flex flex-col gap-2.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--accent-soft)] px-4 py-3.5">
                  <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-secondary)]">
                    Amenities
                  </h2>
                  <ul className="flex flex-wrap gap-1.5">
                    {listing.amenities.map((amenity) => (
                      <li
                        key={amenity}
                        className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-[12px] font-medium text-[var(--ink-secondary)]"
                      >
                        {amenity}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] p-2.5 lg:p-3">
                <ApproxAreaMap
                  approxLat={listing.approxLat}
                  approxLng={listing.approxLng}
                  approxRadiusM={listing.approxRadiusM}
                  locationLabel={locationLine}
                />
              </div>
            </div>
          </div>

          <aside className="flex w-full flex-col gap-3.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 lg:sticky lg:top-24 lg:w-[320px] lg:shrink-0 lg:p-5">
            <p className="font-display text-[22px] font-semibold leading-[1.2] text-[var(--ink)]">
              Ask for pricing
            </p>
            <p className="text-[13px] leading-[1.6] text-[var(--muted)]">
              Ask for pricing. Desks and cabins vary.
            </p>
            <LikeSpaceButton
              variant="cta"
              propertyName={listing.title}
              propertyUrl={propertyUrl}
            />
            <p className="text-[12px] leading-[1.6] text-[var(--ink-secondary)]">
              Opens a draft with this property. We never auto-send.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
