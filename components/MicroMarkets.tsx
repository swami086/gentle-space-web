"use client";

import { Reveal } from "@/components/motion/Reveal";

const MARKETS = [
  "Whitefield",
  "Outer Ring Road",
  "Koramangala",
  "Indiranagar",
  "HSR Layout",
  "Electronic City",
  "MG Road",
  "Sarjapur Road",
] as const;

export function MicroMarkets() {
  return (
    <section
      id="locations"
      className="border-y border-[var(--border)] bg-[var(--surface)]"
    >
      <Reveal className="mx-auto max-w-[1120px] px-5 py-14 lg:px-10">
        <h2 className="font-display text-[clamp(22px,2.6vw,28px)] font-semibold leading-[1.25] text-[var(--ink)]">
          We cover all locations in and around Bengaluru.
        </h2>
        <p className="mt-3.5 text-[15px] font-medium leading-[1.7] text-[var(--ink-secondary)]">
          {MARKETS.join(" · ")}
        </p>
      </Reveal>
    </section>
  );
}
