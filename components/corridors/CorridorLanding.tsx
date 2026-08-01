"use client";

import { useLeadCapture } from "@/components/LeadCaptureContext";
import { Reveal } from "@/components/motion/Reveal";
import { CORRIDORS, type Corridor } from "@/lib/corridors";

export function CorridorLanding({ corridor }: { corridor: Corridor }) {
  const { openModal } = useLeadCapture();
  const siblings = CORRIDORS.filter((c) => c.slug !== corridor.slug);

  return (
    <>
      <section className="bg-[var(--bg)]">
        <Reveal className="mx-auto max-w-[1120px] px-5 py-12 lg:px-10 lg:py-16">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
            Bangalore · {corridor.name}
            {corridor.aka ? ` (${corridor.aka})` : ""}
          </p>
          <h1 className="mt-3 max-w-[20ch] font-display text-[clamp(28px,3.4vw,40px)] font-semibold leading-[1.2] text-[var(--ink)]">
            {corridor.tagline}
          </h1>
          <p className="mt-4 max-w-[62ch] text-[17px] leading-[1.55] text-[var(--muted)]">
            {corridor.intro}
          </p>
          <div className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={openModal}
              className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-7 py-3.5 text-[15px] font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-dark)]"
            >
              Share your brief
            </button>
            <a
              href="/spaces"
              className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-[var(--ink)] transition hover:text-[var(--accent)]"
            >
              See available spaces
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </Reveal>
      </section>

      <section className="border-y border-[var(--border)] bg-[var(--surface)]">
        <Reveal className="mx-auto grid max-w-[1120px] gap-8 px-5 py-12 lg:grid-cols-3 lg:px-10">
          <div>
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-secondary)]">
              Known for
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {corridor.knownFor.map((item) => (
                <li key={item} className="text-[15px] leading-[1.5] text-[var(--ink)]">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-secondary)]">
              Space types
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {corridor.spaceTypes.map((item) => (
                <li key={item} className="text-[15px] leading-[1.5] text-[var(--ink)]">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-secondary)]">
              Best for
            </h2>
            <p className="mt-3 text-[15px] leading-[1.6] text-[var(--ink)]">
              {corridor.bestFor}
            </p>
          </div>
        </Reveal>
      </section>

      <section className="bg-[var(--bg)]">
        <Reveal className="mx-auto max-w-[1120px] px-5 py-12 lg:px-10">
          <h2 className="font-display text-[clamp(20px,2.4vw,26px)] font-semibold leading-[1.25] text-[var(--ink)]">
            Other Bangalore corridors we cover
          </h2>
          <div className="mt-4 flex flex-wrap gap-2.5">
            {siblings.map((c) => (
              <a
                key={c.slug}
                href={`/bangalore/${c.slug}`}
                className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[14px] font-medium text-[var(--ink-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                {c.name}
              </a>
            ))}
          </div>
        </Reveal>
      </section>
    </>
  );
}
