"use client";

import Image from "next/image";
import { HeroQuickBrief } from "@/components/HeroQuickBrief";
import { Reveal } from "@/components/motion/Reveal";
import { CONTENT } from "@/lib/content";
import { SITE } from "@/lib/site";

export function Hero() {
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

            <HeroQuickBrief />
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
