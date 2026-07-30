import { LeadCaptureModal } from "@/components/LeadCaptureModal";
import { LeadCaptureProvider } from "@/components/LeadCaptureContext";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export default function SpacesLayout({ children }: { children: React.ReactNode }) {
  return (
    <LeadCaptureProvider>
      <div className="flex min-h-full flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </div>
      <LeadCaptureModal />
    </LeadCaptureProvider>
  );
}
