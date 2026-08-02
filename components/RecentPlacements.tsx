"use client";

import {
  IconBuilding,
  IconSofa,
  IconStore,
  IconWarehouse,
} from "@/components/icons";
import { Reveal } from "@/components/motion/Reveal";
import { RECENT_PLACEMENTS } from "@/lib/content-placements";

function iconFor(type: string) {
  const t = type.toLowerCase();
  if (t.includes("retail")) return IconStore;
  if (t.includes("warehouse")) return IconWarehouse;
  if (t.includes("managed") || t.includes("cowork")) return IconSofa;
  return IconBuilding;
}

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
          {RECENT_PLACEMENTS.map((placement, index) => {
            const Icon = iconFor(placement.type);
            return (
              <li
                key={`${placement.area}-${placement.type}-${index}`}
                className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius)] bg-[var(--accent-soft)] text-[var(--accent)]">
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="rounded-[var(--radius)] bg-[var(--accent-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--accent)]">
                    {placement.type}
                  </span>
                </div>
                <div>
                  <div className="text-[22px] font-semibold leading-none text-[var(--ink)]">
                    ~{placement.sizeSqft.toLocaleString("en-IN")}{" "}
                    <span className="text-[13px] font-normal text-[var(--muted)]">
                      sq ft
                    </span>
                  </div>
                  <div className="mt-1.5 text-[13px] text-[var(--muted)]">
                    {placement.area} · {placement.sector}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Reveal>
    </section>
  );
}
