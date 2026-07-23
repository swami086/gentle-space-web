"use client";

import { BrandLogoMark } from "@/components/BrandLogoMark";
import { SITE } from "@/lib/site";
import { useLeadCapture } from "@/components/LeadCaptureContext";

const NAV_LINKS = [
  ["Services", "#services"],
  ["Why Us", "#why-us"],
  ["How It Works", "#how-it-works"],
  ["Locations", "#locations"],
  ["Founder", "#founder"],
] as const;

export function SiteHeader() {
  const { openModal } = useLeadCapture();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]">
      <div className="flex flex-wrap items-center gap-4 px-6 py-6 lg:px-[160px]">
        <a href="/" className="flex items-center gap-3">
          <BrandLogoMark />
          <span className="text-lg font-semibold tracking-tight text-[var(--ink)]">{SITE.name}</span>
        </a>

        <nav
          aria-label="Primary"
          className="order-3 flex-1 overflow-x-auto lg:order-none"
        >
          <div className="flex min-w-max items-center gap-6 text-sm font-medium text-[var(--ink-secondary)]">
            {NAV_LINKS.map(([label, href]) => (
              <a
                key={label}
                href={href}
                className="transition hover:text-[var(--ink)]"
              >
                {label}
              </a>
            ))}
          </div>
        </nav>

        <button
          type="button"
          onClick={openModal}
          className="rounded-full border border-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)] hover:text-[var(--on-accent)]"
        >
          Contact Us
        </button>
      </div>
    </header>
  );
}
