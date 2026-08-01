"use client";

import Image from "next/image";
import { useLeadCapture } from "@/components/LeadCaptureContext";
import { Reveal } from "@/components/motion/Reveal";
import { CONTENT } from "@/lib/content";
import { SITE } from "@/lib/site";

export function Hero() {
  const { openModal } = useLeadCapture();

  return (
    <section className="bg-[var(--bg)]">
      <Reveal className="mx-auto max-w-[1120px] px-5 py-12 lg:px-10 lg:py-14">
        <div className="grid items-center gap-9 lg:grid-cols-[1.15fr_0.85fr] lg:gap-12">
          <div className="flex w-full flex-col gap-6">
            <h1 className="font-display text-[clamp(26px,3.2vw,36px)] font-semibold leading-[1.25] text-[var(--ink)]">
              {CONTENT.hero.headline}
            </h1>
            <p className="max-w-[480px] text-[17px] leading-[1.55] text-[var(--muted)]">
              {CONTENT.hero.subtext}
            </p>

            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={openModal}
                className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-7 py-3.5 text-[15px] font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-dark)]"
              >
                {CONTENT.hero.primaryCta}
              </button>
              <a
                href="/spaces"
                className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-[var(--ink)] transition hover:text-[var(--accent)]"
              >
                See Available Properties
                <span aria-hidden="true">→</span>
              </a>
            </div>

            <p className="max-w-[480px] text-sm leading-[1.4] text-[var(--muted)]">
              {CONTENT.hero.incentive}
            </p>
          </div>

          <div className="w-full shrink-0">
            <Image
              src={SITE.heroImage}
              alt="Commercial real estate consultation in Bangalore"
              width={480}
              height={420}
              className="h-auto w-full rounded-[var(--radius)] object-cover"
              priority
            />
          </div>
        </div>
      </Reveal>
    </section>
  );
}
