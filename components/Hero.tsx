"use client";

import Image from "next/image";
import { useLeadCapture } from "@/components/LeadCaptureContext";
import { CONTENT } from "@/lib/content";
import { SITE } from "@/lib/site";

export function Hero() {
  const { openModal } = useLeadCapture();

  return (
    <section className="bg-[var(--bg)] px-6 py-20 lg:px-[160px]">
      <div className="flex flex-col items-center gap-[72px] lg:flex-row lg:items-center">
        <div className="flex w-full max-w-[640px] flex-col gap-6">
          <h1 className="text-[36px] font-bold leading-[1.12] tracking-tight text-[var(--ink)] lg:text-[46px]">
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

        <div className="w-full max-w-[480px] shrink-0">
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
