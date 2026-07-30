"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BrandLogoMark } from "@/components/BrandLogoMark";
import { SITE } from "@/lib/site";
import { useLeadCapture } from "@/components/LeadCaptureContext";

const ROUTE_LINKS = [
  ["Home", "/"],
  ["Spaces", "/spaces"],
] as const;

const SECTION_LINKS = [
  ["Services", "#services"],
  ["Why Us", "#why-us"],
  ["How It Works", "#how-it-works"],
  ["Locations", "#locations"],
  ["Founder", "#founder"],
] as const;

function getNavLinks(pathname: string) {
  if (pathname === "/") {
    return [...ROUTE_LINKS, ...SECTION_LINKS];
  }
  return ROUTE_LINKS;
}

function navLinkClass(
  label: string,
  homeActive: boolean,
  spacesActive: boolean,
  mobile = false,
) {
  const active =
    (label === "Home" && homeActive) || (label === "Spaces" && spacesActive);
  const base = mobile
    ? "block rounded-[var(--radius-sm)] px-3 py-3 text-base font-medium hover:bg-[var(--surface)] hover:text-[var(--ink)]"
    : "transition hover:text-[var(--ink)]";
  return [
    base,
    active ? "text-[var(--accent)]" : "text-[var(--ink-secondary)]",
  ].join(" ");
}

export function SiteHeader() {
  const pathname = usePathname();
  const { openModal } = useLeadCapture();
  const [menuOpen, setMenuOpen] = useState(false);
  const spacesActive = pathname.startsWith("/spaces");
  const homeActive = pathname === "/";
  const navLinks = getNavLinks(pathname);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-40 bg-[var(--bg)]">
      <div className="flex items-center justify-between gap-4 px-6 py-6 lg:px-[var(--page-pad-x)]">
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
          {navLinks.map(([label, href]) => (
            <a
              key={label}
              href={href}
              className={navLinkClass(label, homeActive, spacesActive)}
            >
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
            Get My Shortlist
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
            {navLinks.map(([label, href]) => (
              <li key={label}>
                <a
                  href={href}
                  className={navLinkClass(label, homeActive, spacesActive, true)}
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
