import { About } from "@/components/About";
import { CtaBand } from "@/components/CtaBand";
import { FAQ } from "@/components/FAQ";
import { JsonLd } from "@/components/JsonLd";
import { FounderTeaser } from "@/components/FounderTeaser";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { LeadCaptureModal } from "@/components/LeadCaptureModal";
import { LeadCaptureProvider } from "@/components/LeadCaptureContext";
import { MicroMarkets } from "@/components/MicroMarkets";
import { RecentPlacements } from "@/components/RecentPlacements";
import { Services } from "@/components/Services";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Testimonials } from "@/components/Testimonials";
import { faqPageSchema, organizationSchema } from "@/lib/structured-data";

export default function Home() {
  return (
    <LeadCaptureProvider>
      <JsonLd data={organizationSchema()} />
      <JsonLd data={faqPageSchema()} />
      <div className="flex min-h-full flex-col">
        <SiteHeader />
        <main className="flex-1">
          <Hero />
          <Services />
          <HowItWorks />
          <About />
          <MicroMarkets />
          <RecentPlacements />
          <Testimonials />
          <FounderTeaser />
          <FAQ />
          <CtaBand />
        </main>
        <SiteFooter />
      </div>
      <LeadCaptureModal />
    </LeadCaptureProvider>
  );
}
