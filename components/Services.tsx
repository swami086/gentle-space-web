import { SERVICES_CONTENT } from "@/lib/content-services";

function CardIcon() {
  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface-tint)]">
      <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] text-[var(--accent)]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function Services() {
  return (
    <section id="services" className="bg-[var(--bg)] px-6 py-24 lg:px-[160px]">
      <div className="mx-auto flex max-w-[1120px] flex-col items-center gap-14">
        <div className="flex max-w-[640px] flex-col items-center gap-4 text-center">
          <span className="inline-flex rounded-full bg-[var(--surface-tint)] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.4px] text-[var(--accent-dark)]">
            {SERVICES_CONTENT.kicker}
          </span>
          <h2 className="text-[28px] font-bold tracking-tight text-[var(--ink)] lg:text-[34px]">
            {SERVICES_CONTENT.heading}
          </h2>
          <p className="max-w-[520px] text-base leading-[1.5] text-[var(--muted)]">
            {SERVICES_CONTENT.subtext}
          </p>
        </div>

        {SERVICES_CONTENT.groups.map((group) => (
          <div key={group.label} className="flex w-full flex-col items-center gap-6">
            <h3 className="text-center text-[13px] font-bold uppercase tracking-[0.6px] text-[var(--accent-dark)]">
              {group.label}
            </h3>
            <div className="grid w-full gap-6 md:grid-cols-3">
              {group.items.map((item) => (
                <article
                  key={item.title}
                  className="flex flex-col gap-3.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-7"
                >
                  <CardIcon />
                  <h4 className="text-[17px] font-semibold text-[var(--ink)]">{item.title}</h4>
                  <p className="text-sm leading-[1.5] text-[var(--muted)]">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
