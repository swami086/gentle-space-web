"use client";

import { useEffect, useState } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]">
      <div className="flex items-center justify-between gap-4 px-6 py-6 lg:px-[160px]">
        <a href="/" className="flex min-w-0 items-center gap-2.5">
          <BrandLogoMark />
          <span className="truncate text-[19px] font-bold tracking-tight text-[var(--ink)]">
            {SITE.name}
          </span>
        </a>

        <nav
          aria-label="Primary"
          className="hidden items-center gap-9 text-sm font-medium text-[var(--ink-secondary)] lg:flex"
        >
          {NAV_LINKS.map(([label, href]) => (
            <a key={label} href={href} className="transition hover:text-[var(--ink)]">
              {label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={openModal}
            className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-dark)]"
          >
            Share My Custom Brief
          </button>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--ink)] lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {menuOpen ? (
                <>
                  <path d="M6 6l12 12" />
                  <path d="M18 6L6 18" />
                </>
              ) : (
                <>
                  <path d="M4 7h16" />
                  <path d="M4 12h16" />
                  <path d="M4 17h16" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen ? (
        <nav id="mobile-nav" aria-label="Mobile" className="border-t border-[var(--border)] bg-[var(--bg)] px-6 py-4 lg:hidden">
          <ul className="flex flex-col gap-1">
            {NAV_LINKS.map(([label, href]) => (
              <li key={label}>
                <a
                  href={href}
                  className="block rounded-[var(--radius-sm)] px-3 py-3 text-base font-medium text-[var(--ink-secondary)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
                  onClick={() => setMenuOpen(false)}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
