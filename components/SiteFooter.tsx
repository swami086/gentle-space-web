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
    <footer id="contact" className="border-t border-[var(--border)] bg-[var(--bg)] px-5 py-12 lg:px-10">
      <div className="mx-auto grid max-w-[1120px] gap-8 lg:grid-cols-[1.3fr_0.7fr_1fr]">
        <div className="max-w-[36ch]">
          <a href="/" className="inline-flex items-center gap-2">
            <BrandLogoMark />
            <span className="text-base font-bold tracking-tight text-[var(--ink)]">{SITE.name}</span>
          </a>
          <p className="mt-3 text-[13px] leading-[1.55] text-[var(--muted)]">
            Commercial real estate consulting in Bangalore, for companies and property owners across every property type.
          </p>
        </div>

        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--accent)]">
            Company
          </h2>
          <ul className="mt-2.5 space-y-2 text-[13px] text-[var(--ink-secondary)]">
            {COMPANY_LINKS.map(([label, href]) => (
              <li key={label}>
                <a href={href} className="transition hover:text-[var(--accent)]">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--accent)]">
            Contact
          </h2>
          <ul className="mt-2.5 space-y-2 text-[13px] leading-6 text-[var(--ink-secondary)]">
            <li>
              <a href={`mailto:${SITE.email}`} className="transition hover:text-[var(--accent)]">
                {SITE.email}
              </a>
            </li>
            <li>
              <a href={`tel:${SITE.phoneE164}`} className="transition hover:text-[var(--accent)]">
                {SITE.phoneDisplay}
              </a>
            </li>
            <li>{SITE.addressShort}</li>
            <li>
              <a href={SITE.mapsUrl} target="_blank" rel="noreferrer" className="transition hover:text-[var(--accent)]">
                Get directions on Google Maps
              </a>
            </li>
            <li>GSTIN: {SITE.gstin}</li>
            <li>CIN: {SITE.cin}</li>
          </ul>
        </div>
      </div>

      <p className="mx-auto mt-8 max-w-[1120px] text-xs text-[var(--muted)]">
        © 2026 Gentle Space Global Solutions. All rights reserved.
      </p>
    </footer>
  );
}
