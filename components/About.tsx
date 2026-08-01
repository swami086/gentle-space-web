"use client";

import { Reveal } from "@/components/motion/Reveal";

export function About() {
  const pills = ["Verified before you tour", "Legal and paperwork through close", "Bangalore-wide coverage"];

  return (
    <section id="why-us" className="bg-[var(--bg)]">
      <Reveal className="mx-auto max-w-[1120px] px-5 py-12 lg:px-10 lg:py-14">
        <div className="grid gap-7 lg:grid-cols-[1.4fr_0.8fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold">
              <span className="inline-flex rounded-full bg-[var(--surface-tint)] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-dark)]">
                WHY GENTLE SPACE
              </span>
            </p>
            <h2 className="mt-4 font-display text-[clamp(22px,2.6vw,28px)] font-semibold leading-[1.25] text-[var(--ink)]">
              Why companies and owners work with Gentle Space CRE
            </h2>
            <p className="mt-3 max-w-[56ch] text-[15px] leading-[1.6] text-[var(--muted)]">
              Most leases run into trouble in the fine print. We check it before you tour a
              property, then stay on the deal through legal and handover. Property owners get the
              same coverage from the other side: a tenant we&apos;ve actually vetted, and a close we
              manage end to end.
            </p>

            <div className="mt-[18px] flex flex-wrap gap-2">
              {pills.map((pill) => (
                <span
                  key={pill}
                  className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--ink)]"
                >
                  {pill}
                </span>
              ))}
            </div>
          </div>

          <aside className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--accent-soft)] p-[22px]">
            <h3 className="text-base font-semibold tracking-tight text-[var(--ink)]">How our fee works</h3>
            <p className="mt-2 text-sm leading-[1.55] text-[var(--ink-secondary)]">
              Standard requirements cost you nothing. A highly customised search outside our
              existing network carries a fixed fee, agreed upfront.
            </p>
          </aside>
        </div>
      </Reveal>
    </section>
  );
}
