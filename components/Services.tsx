import { SERVICES_CONTENT } from "@/lib/content-services";

export function Services() {
  return (
    <section id="services" className="px-6 py-20 lg:px-[160px]">
      <div className="max-w-[1120px]">
        <p className="text-sm font-semibold">
          <span className="inline-flex rounded-full bg-[var(--surface-tint)] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-dark)]">
            {SERVICES_CONTENT.kicker}
          </span>
        </p>

        <div className="mt-4 max-w-[760px]">
          <h2 className="text-3xl font-semibold tracking-tight text-[var(--ink)] lg:text-5xl">
            {SERVICES_CONTENT.heading}
          </h2>
          <p className="mt-5 text-base leading-8 text-[var(--muted)] lg:text-lg">
            {SERVICES_CONTENT.subtext}
          </p>
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-2">
          {SERVICES_CONTENT.groups.map((group) => (
            <div key={group.label}>
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-dark)]">
                {group.label}
              </h3>
              <div className="mt-5 grid gap-5">
                {group.items.map((item) => (
                  <article
                    key={item.title}
                    className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] p-7"
                  >
                    <h4 className="text-lg font-semibold tracking-tight text-[var(--ink)]">
                      {item.title}
                    </h4>
                    <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
                      {item.body}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
