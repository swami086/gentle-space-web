"use client";

import { Reveal } from "@/components/motion/Reveal";
import { RECENT_PLACEMENTS } from "@/lib/content-placements";

export function RecentPlacements() {
  if (RECENT_PLACEMENTS.length === 0) return null;

  return (
    <section className="border-y border-[var(--border)] bg-[var(--surface)]">
      <Reveal className="mx-auto max-w-[1120px] px-5 py-14 lg:px-10">
        <h2 className="font-display text-[clamp(22px,2.6vw,28px)] font-semibold leading-[1.25] text-[var(--ink)]">
          Recent placements
        </h2>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-[1.7] text-[var(--ink-secondary)]">
          A sample of commercial spaces we&apos;ve matched across Bangalore. Details
          are kept general to protect client confidentiality.
        </p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RECENT_PLACEMENTS.map((placement, index) => (
            <li
              key={`${placement.area}-${placement.type}-${index}`}
              className="flex flex-col gap-1.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] font-semibold text-[var(--ink)]">
                  {placement.area}
                </span>
                <span className="rounded-[var(--radius)] bg-[var(--accent-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--accent)]">
                  {placement.type}
                </span>
              </div>
              <span className="text-[13px] text-[var(--muted)]">
                ~{placement.sizeSqft.toLocaleString("en-IN")} sq ft · {placement.sector}
              </span>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}
