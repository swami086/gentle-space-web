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
    <section className="px-6 py-20 lg:px-[160px]">
      <div className="max-w-[1120px]">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-dark)]">
          CLIENT NOTES
        </p>
        <h2 className="mt-4 max-w-[640px] text-3xl font-semibold tracking-tight text-[var(--ink)] lg:text-5xl">
          What Bangalore clients say about Gentle Space
        </h2>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          {TESTIMONIALS.map((testimonial) => (
            <figure
              key={testimonial.name}
              className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_1px_0_rgba(30,22,48,0.04)]"
            >
              <blockquote className="text-base leading-7 text-[var(--ink)]">
                “{testimonial.quote}”
              </blockquote>
              <figcaption className="mt-6 text-sm leading-6 text-[var(--ink-secondary)]">
                <span className="font-semibold text-[var(--ink)]">{testimonial.name}</span>
                <span className="mx-2 text-[var(--muted)]">•</span>
                <span>{testimonial.role}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
