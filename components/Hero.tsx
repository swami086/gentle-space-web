"use client";

import Image from "next/image";
import { useLeadCapture } from "@/components/LeadCaptureContext";
import { CONTENT } from "@/lib/content";
import { SITE } from "@/lib/site";

export function Hero() {
  const { openModal } = useLeadCapture();

  return (
    <section className="px-6 py-20 lg:px-[160px]">
      <div className="flex flex-col items-center gap-[72px] lg:flex-row lg:items-center">
        <div className="max-w-[640px]">
          <h1 className="text-4xl font-semibold tracking-tight text-[var(--ink)] lg:text-6xl">
            {CONTENT.hero.headline}
          </h1>
          <p className="mt-6 text-base leading-8 text-[var(--muted)] lg:text-lg">
            {CONTENT.hero.subtext}
          </p>

          <div className="mt-8 flex flex-col gap-4 sm:flex-row">
            <button
              type="button"
              onClick={openModal}
              className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-7 py-3.5 text-sm font-medium text-[var(--on-accent)] transition hover:bg-[var(--accent-dark)]"
            >
              {CONTENT.hero.primaryCta}
            </button>
            <a
              href="#services"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent-dark)] transition hover:text-[var(--accent)]"
            >
              {CONTENT.hero.secondaryCta}
              <span aria-hidden="true">→</span>
            </a>
          </div>

          <p className="mt-6 max-w-[520px] text-sm leading-6 text-[var(--muted)]">
            {CONTENT.hero.incentive}
          </p>
        </div>

        <div className="w-full max-w-[480px]">
          <Image
            src={SITE.heroImage}
            alt="Commercial real estate consultation in Bangalore"
            width={480}
            height={420}
            className="h-auto w-full rounded-[var(--radius-lg)] object-cover"
            priority
          />
        </div>
      </div>
    </section>
  );
}
