import { BrandLogoMark } from "@/components/BrandLogoMark";
import { SITE } from "@/lib/site";

const COMPANY_LINKS = [
  ["About the Founder", "#founder"],
  ["Services", "#services"],
  ["How It Works", "#how-it-works"],
  ["Locations", "#locations"],
  ["Founder", "#founder"],
  ["Contact", "#contact"],
] as const;

export function SiteFooter() {
  return (
    <footer id="contact" className="border-t border-[var(--border)] bg-[var(--bg)] px-6 py-16 lg:px-[160px]">
      <div className="grid gap-12 lg:grid-cols-[1.2fr_0.8fr_1fr]">
        <div className="max-w-[420px]">
          <a href="/" className="inline-flex items-center gap-3">
            <BrandLogoMark />
            <span className="text-lg font-semibold tracking-tight text-[var(--ink)]">{SITE.name}</span>
          </a>
          <p className="mt-5 text-sm leading-7 text-[var(--ink-secondary)]">
            Top commercial real estate consultants in Bangalore. Specialists in custom requirements for companies and property owners.
          </p>
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-dark)]">
            Company
          </h2>
          <ul className="mt-5 space-y-3 text-sm text-[var(--ink-secondary)]">
            {COMPANY_LINKS.map(([label, href]) => (
              <li key={label}>
                <a href={href} className="transition hover:text-[var(--ink)]">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-dark)]">
            Contact
          </h2>
          <ul className="mt-5 space-y-3 text-sm leading-6 text-[var(--ink-secondary)]">
            <li>
              <a href={`mailto:${SITE.email}`} className="transition hover:text-[var(--ink)]">
                {SITE.email}
              </a>
            </li>
            <li>
              <a href={`tel:${SITE.phoneE164}`} className="transition hover:text-[var(--ink)]">
                {SITE.phoneDisplay}
              </a>
            </li>
            <li>{SITE.addressShort}</li>
            <li>
              <a href={SITE.mapsUrl} target="_blank" rel="noreferrer" className="transition hover:text-[var(--ink)]">
                Get directions on Google Maps
              </a>
            </li>
            <li>GSTIN: {SITE.gstin}</li>
            <li>CIN: {SITE.cin}</li>
          </ul>
        </div>
      </div>

      <p className="mt-12 text-sm text-[var(--muted)]">
        © 2026 Gentle Space Global Solutions. All rights reserved.
      </p>
    </footer>
  );
}
