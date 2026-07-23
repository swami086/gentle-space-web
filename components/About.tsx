function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-[var(--accent)]" fill="currentColor" aria-hidden="true">
      <path d="M6.5 11.2 3.3 8l1.1-1.1 2.1 2.1 5-5L12.6 5l-6.1 6.2z" />
    </svg>
  );
}

export function About() {
  const pills = ["Client-Focused Consulting", "Proven Track Record", "Local expertise"];

  return (
    <section id="why-us" className="bg-[var(--bg)] px-6 py-24 lg:px-[160px]">
      <div className="mx-auto grid max-w-[1120px] items-center gap-[72px] lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-5">
          <span className="inline-flex w-fit rounded-full bg-[var(--surface-tint)] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.4px] text-[var(--accent-dark)]">
            WHY GENTLE SPACE
          </span>
          <h2 className="text-[28px] font-bold tracking-tight text-[var(--ink)] lg:text-[34px]">
            Why choose Gentle Space for commercial real estate in Bangalore
          </h2>
          <p className="text-base leading-[1.6] text-[var(--muted)]">
            Gentle Space is a commercial real estate consulting firm in Bangalore that specialises
            in custom requirements. We remove friction for companies and property owners so deals
            close cleanly. Companies establishing or expanding here get office and retail options
            matched to location, budget, size, building quality, commute, and lease terms. Property
            owners get high-quality screened tenants and market-based rents. We thoroughly validate
            property documents and other legal aspects, so high-quality transactions close end to
            end in a high-trust manner.
          </p>
          <div className="flex flex-wrap gap-7">
            {pills.map((pill) => (
              <div key={pill} className="flex items-center gap-2">
                <CheckIcon />
                <span className="text-[13px] font-semibold text-[var(--ink-secondary)]">{pill}</span>
              </div>
            ))}
          </div>
        </div>

        <aside className="flex flex-col gap-3 rounded-[var(--radius-lg)] bg-[var(--accent-dark)] p-8 text-white">
          <svg viewBox="0 0 28 28" className="h-7 w-7 text-white" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="4" y="6" width="20" height="16" rx="2" />
            <path d="M4 11h20" />
          </svg>
          <h3 className="text-[22px] font-bold tracking-tight">How fees work</h3>
          <p className="text-sm leading-[1.5] text-white/80">
            We charge no fees for standard requirements. For highly customised needs where we invest
            our efforts, we charge a fixed fee.
          </p>
        </aside>
      </div>
    </section>
  );
}
