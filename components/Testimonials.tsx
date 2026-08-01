"use client";

import { Reveal } from "@/components/motion/Reveal";

const TESTIMONIALS = [
  {
    quote:
      "They understood the Whitefield brief quickly and kept the search tight. We signed without a long detour through irrelevant floors.",
    name: "Priya Nair",
    role: "Admin Head, Health Insurance Company",
  },
  {
    quote:
      "Gentle Space ran the negotiation end to end. Clear process, no surprises on fee or timeline.",
    name: "Arjun Mehta",
    role: "CEO, Series B SaaS Startup",
  },
  {
    quote:
      "Helped us take our first Bangalore office. Practical advice on rent and location, not a brochure pitch.",
    name: "Karthik Iyer",
    role: "Head of India Operations, US-based GCC",
  },
  {
    quote:
      "Found a tenant quickly and landed a fair rent. Straightforward from first call to handover.",
    name: "Suresh Rao",
    role: "Owner, commercial building on Outer Ring Road",
  },
] as const;

export function Testimonials() {
  return (
    <section className="py-14">
      <Reveal className="mx-auto max-w-[1120px] px-5 lg:px-10">
        <div className="mb-7 max-w-[640px]">
          <h2 className="font-display text-[clamp(22px,2.6vw,28px)] font-semibold leading-[1.25] text-[var(--ink)]">
            What Bangalore clients say about Gentle Space
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {TESTIMONIALS.map((testimonial, index) => (
            <Reveal key={testimonial.name} delay={index * 0.04}>
              <figure className="h-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-[18px]">
                <blockquote className="font-display text-[15px] leading-[1.55] text-[var(--ink)]">
                  {testimonial.quote}
                </blockquote>
                <figcaption className="mt-3 text-xs text-[var(--muted)]">
                  <strong className="font-semibold text-[var(--ink)]">
                    {testimonial.name}
                  </strong>
                  {" · "}
                  {testimonial.role}
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
