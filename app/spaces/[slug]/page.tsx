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
    <div className="px-6 py-8 lg:px-[var(--page-pad-x)] lg:pb-16 lg:pt-8">
      <div className="mb-10">
        <SpaceGallery title={listing.title} images={listing.images} />
      </div>

      <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-10">
        <div className="min-w-0 flex-1 lg:max-w-[760px]">
          <div className="flex flex-col gap-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h1 className="text-[28px] font-bold text-[var(--ink)]">{listing.title}</h1>
                <p className="mt-1 text-[15px] text-[var(--ink-secondary)]">{locationLine}</p>
              </div>
              <LikeSpaceButton
                variant="pill"
                propertyName={listing.title}
                propertyUrl={propertyUrl}
              />
            </div>

            {listing.shortTeaser ? (
              <p className="text-[17px] font-medium leading-[1.5] text-[var(--ink)]">
                {listing.shortTeaser}
              </p>
            ) : null}

            {listing.description ? (
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-[var(--muted)]">
                {listing.description}
              </p>
            ) : null}

            {listing.amenities.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold text-[var(--ink)]">Amenities</h2>
                <ul className="flex flex-wrap gap-2">
                  {listing.amenities.map((amenity) => (
                    <li
                      key={amenity}
                      className="rounded-full bg-[var(--surface-tint)] px-3 py-1.5 text-sm text-[var(--accent-dark)]"
                    >
                      {amenity}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <ApproxAreaMap
              approxLat={listing.approxLat}
              approxLng={listing.approxLng}
              approxRadiusM={listing.approxRadiusM}
              locationLabel={locationLine}
            />
          </div>
        </div>

        <aside className="flex w-full flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)] p-6 lg:sticky lg:top-24 lg:w-[340px] lg:shrink-0">
          <p className="text-[22px] font-bold text-[var(--ink)]">Ask for pricing</p>
          <p className="text-[13px] text-[var(--muted)]">Ask for pricing. Desks and cabins vary.</p>
          <LikeSpaceButton
            variant="cta"
            propertyName={listing.title}
            propertyUrl={propertyUrl}
          />
          <p className="text-[12px] text-[var(--muted)]">
            Opens a draft with this property. We never auto-send.
          </p>
        </aside>
      </div>
    </div>
  );
}
