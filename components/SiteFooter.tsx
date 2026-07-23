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
            <li>{`GSTIN: ${SITE.gstin}`}</li>
            <li>{`CIN: ${SITE.cin}`}</li>
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
          <span className="inline-flex" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
            </svg>
          </span>
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
