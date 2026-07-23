import { BrandLogoMark } from "@/components/BrandLogoMark";
import { SITE } from "@/lib/site";

const COMPANY_LINKS = [
  ["About the Founder", "#founder"],
  ["Services", "#services"],
  ["How It Works", "#how-it-works"],
  ["Locations", "#locations"],
  ["Founder", "#founder"],
] as const;

export function SiteFooter() {
  return (
    <footer id="contact" className="bg-[var(--ink)] px-6 pb-8 pt-16 text-white lg:px-[160px]">
      <div className="grid gap-[72px] lg:grid-cols-3">
        <div className="max-w-[320px]">
          <a href="/" className="inline-flex items-center gap-2.5">
            <BrandLogoMark />
            <span className="text-[17px] font-bold tracking-tight">{SITE.name}</span>
          </a>
          <p className="mt-3 text-sm leading-[1.5] text-white/60">
            Top commercial real estate consultants in Bangalore. Specialists in custom requirements
            for companies and property owners.
          </p>
        </div>

        <div>
          <h2 className="text-[13px] font-bold tracking-[0.3px]">Company</h2>
          <ul className="mt-3.5 space-y-2.5 text-sm text-white/60">
            {COMPANY_LINKS.map(([label, href]) => (
              <li key={label}>
                <a href={href} className="transition hover:text-white">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-[13px] font-bold tracking-[0.3px]">Contact</h2>
          <ul className="mt-3.5 space-y-2.5 text-sm leading-[1.45] text-white/60">
            <li>
              <a href={`mailto:${SITE.email}`} className="transition hover:text-white">
                {SITE.email}
              </a>
            </li>
            <li>
              <a href={`tel:${SITE.phoneE164}`} className="transition hover:text-white">
                {SITE.phoneDisplay}
              </a>
            </li>
            <li className="max-w-[280px]">{SITE.addressShort}</li>
            <li>
              <a
                href={SITE.mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-white/80 transition hover:text-white"
              >
                Get directions on Google Maps
              </a>
            </li>
            <li>GSTIN: {SITE.gstin}</li>
            <li>CIN: {SITE.cin}</li>
          </ul>
        </div>
      </div>

      <div className="mt-10 h-px w-full bg-white/15" />

      <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-white/50">
          © 2026 Gentle Space Global Solutions. All rights reserved.
        </p>
        <div className="flex items-center gap-4 text-white/60">
          <a href={SITE.linkedinCompany} target="_blank" rel="noreferrer" aria-label="LinkedIn">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
              <path d="M4.98 3.5C4.98 4.88 3.86 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.5 8.5h4V23h-4V8.5zM8.5 8.5h3.8v2h.05c.53-1 1.82-2.05 3.75-2.05 4.01 0 4.75 2.64 4.75 6.07V23h-4v-6.6c0-1.57-.03-3.59-2.19-3.59-2.19 0-2.53 1.71-2.53 3.48V23h-4V8.5z" />
            </svg>
          </a>
          <a href={`mailto:${SITE.email}`} aria-label="Email">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
              <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z" />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
