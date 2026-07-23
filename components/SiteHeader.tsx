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
      <div className="flex items-center gap-3 px-6 py-4 lg:gap-4 lg:px-[160px] lg:py-6">
        <a href="/" className="mr-auto flex min-w-0 items-center gap-3">
          <BrandLogoMark />
          <span className="truncate text-lg font-semibold tracking-tight text-[var(--ink)]">
            {SITE.name}
          </span>
        </a>

        <nav
          aria-label="Primary"
          className="hidden items-center gap-6 text-sm font-medium text-[var(--ink-secondary)] lg:flex"
        >
          {NAV_LINKS.map(([label, href]) => (
            <a
              key={label}
              href={href}
              className="transition hover:text-[var(--ink)]"
            >
              {label}
            </a>
          ))}
        </nav>

        <button
          type="button"
          onClick={openModal}
          className="rounded-full border border-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)] hover:text-[var(--on-accent)] lg:px-5"
        >
          Share My Custom Brief
        </button>

        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] text-[var(--ink)] lg:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
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

      {menuOpen ? (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="border-t border-[var(--border)] bg-[var(--bg)] px-6 py-4 lg:hidden"
        >
          <ul className="flex flex-col gap-1">
            {NAV_LINKS.map(([label, href]) => (
              <li key={label}>
                <a
                  href={href}
                  className="block rounded-[var(--radius-sm)] px-3 py-3 text-base font-medium text-[var(--ink-secondary)] transition hover:bg-[var(--surface)] hover:text-[var(--ink)]"
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
