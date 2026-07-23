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
    <section className="bg-[var(--bg)] px-6 py-24 lg:px-[160px]">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-14">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="inline-flex rounded-full bg-[var(--surface-tint)] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.4px] text-[var(--accent-dark)]">
            CLIENT NOTES
          </span>
          <h2 className="max-w-[640px] text-[28px] font-bold tracking-tight text-[var(--ink)] lg:text-[34px]">
            What Bangalore clients say about Gentle Space
          </h2>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {TESTIMONIALS.map((t) => (
            <figure
              key={t.name}
              className="flex flex-col gap-6 rounded-[var(--radius-md)] bg-[var(--surface)] p-8"
            >
              <blockquote className="text-base leading-[1.6] text-[var(--ink)]">
                “{t.quote}”
              </blockquote>
              <figcaption>
                <p className="text-[15px] font-semibold text-[var(--ink)]">{t.name}</p>
                <p className="text-[13px] text-[var(--muted)]">{t.role}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
