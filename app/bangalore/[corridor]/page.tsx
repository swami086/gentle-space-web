import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CorridorLanding } from "@/components/corridors/CorridorLanding";
import { CtaBand } from "@/components/CtaBand";
import { HowItWorks } from "@/components/HowItWorks";
import { JsonLd } from "@/components/JsonLd";
import { LeadCaptureModal } from "@/components/LeadCaptureModal";
import { LeadCaptureProvider } from "@/components/LeadCaptureContext";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { CorridorListingsPreview } from "@/components/corridors/CorridorListingsPreview";
import { getCorridor } from "@/lib/corridors";
import { applySpacesFilters } from "@/lib/listings/filterListings";
import { toPublicListing, type PublicListing } from "@/lib/listings/public";
import { SITE_URL } from "@/lib/site";
import { breadcrumbSchema, organizationSchema } from "@/lib/structured-data";

type PageProps = {
  params: Promise<{ corridor: string }>;
};

// Rendered per request so the corridor preview reflects live inventory (the DB
// is unreachable during `next build`, same reason /spaces is force-dynamic).
export const dynamic = "force-dynamic";

const PREVIEW_COUNT = 5;

async function loadCorridorListings(areaName: string): Promise<PublicListing[]> {
  try {
    const { listListings } = await import("@/lib/db/listings");
    const rows = await listListings();
    const listings = rows.map(toPublicListing);
    return applySpacesFilters(listings, {
      deskTypes: [],
      areas: [areaName],
      amenities: [],
    }).slice(0, PREVIEW_COUNT);
  } catch (err) {
    console.error("[corridor] loadCorridorListings failed", err);
    return [];
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { corridor: slug } = await params;
  const corridor = getCorridor(slug);
  if (!corridor) return { title: "Corridor not found" };

  return {
    title: corridor.metaTitle,
    description: corridor.metaDescription,
    alternates: { canonical: `/bangalore/${slug}` },
    openGraph: {
      title: corridor.metaTitle,
      description: corridor.metaDescription,
      url: `/bangalore/${slug}`,
    },
  };
}

export default async function CorridorPage({ params }: PageProps) {
  const { corridor: slug } = await params;
  const corridor = getCorridor(slug);
  if (!corridor) notFound();

  const breadcrumbs = breadcrumbSchema([
    { name: "Home", url: `${SITE_URL}/` },
    { name: "Spaces", url: `${SITE_URL}/spaces` },
    { name: corridor.name, url: `${SITE_URL}/bangalore/${slug}` },
  ]);

  const previewListings = await loadCorridorListings(corridor.name);

  return (
    <LeadCaptureProvider>
      <JsonLd data={organizationSchema()} />
      <JsonLd data={breadcrumbs} />
      <div className="flex min-h-full flex-col">
        <SiteHeader />
        <main className="flex-1">
          <CorridorLanding corridor={corridor}>
            <CorridorListingsPreview
              listings={previewListings}
              corridorName={corridor.name}
            />
          </CorridorLanding>
          <HowItWorks />
          <CtaBand />
        </main>
        <SiteFooter />
      </div>
      <LeadCaptureModal />
    </LeadCaptureProvider>
  );
}
