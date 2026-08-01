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
import { CORRIDORS, getCorridor } from "@/lib/corridors";
import { SITE_URL } from "@/lib/site";
import { breadcrumbSchema, organizationSchema } from "@/lib/structured-data";

type PageProps = {
  params: Promise<{ corridor: string }>;
};

export function generateStaticParams() {
  return CORRIDORS.map((corridor) => ({ corridor: corridor.slug }));
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

  return (
    <LeadCaptureProvider>
      <JsonLd data={organizationSchema()} />
      <JsonLd data={breadcrumbs} />
      <div className="flex min-h-full flex-col">
        <SiteHeader />
        <main className="flex-1">
          <CorridorLanding corridor={corridor} />
          <HowItWorks />
          <CtaBand />
        </main>
        <SiteFooter />
      </div>
      <LeadCaptureModal />
    </LeadCaptureProvider>
  );
}
