export function About() {
  const pills = ["Client-Focused Consulting", "Proven Track Record", "Local expertise"];

  return (
    <section id="why-us" className="px-6 py-20 lg:px-[160px]">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)] lg:items-start">
        <div>
          <p className="text-sm font-semibold">
            <span className="inline-flex rounded-full bg-[var(--surface-tint)] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-dark)]">
              WHY GENTLE SPACE
            </span>
          </p>
          <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-[var(--ink)] lg:text-5xl">
            Why choose Gentle Space for commercial real estate in Bangalore
          </h2>
          <p className="mt-6 max-w-2xl text-base leading-8 text-[var(--muted)] lg:text-lg">
            Gentle Space is a commercial real estate consulting firm in Bangalore that
            specialises in custom requirements. We remove friction for companies and property
            owners so deals close cleanly. Companies establishing or expanding here get office
            and retail options matched to location, budget, size, building quality, commute, and
            lease terms. Property owners get high-quality screened tenants and market-based rents.
            We thoroughly validate property documents and other legal aspects, so high-quality
            transactions close end to end in a high-trust manner.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {pills.map((pill) => (
              <span
                key={pill}
                className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--ink)]"
              >
                {pill}
              </span>
            ))}
          </div>
        </div>

        <aside className="rounded-[var(--radius-lg)] bg-[var(--accent-dark)] p-6 text-[var(--on-accent)] lg:p-8">
          <h3 className="text-xl font-semibold tracking-tight">How fees work</h3>
          <p className="mt-4 text-sm leading-7 text-[var(--on-accent)]/90">
            We charge no fees for standard requirements. For highly customised needs where we
            invest our efforts, we charge a fixed fee.
          </p>
        </aside>
      </div>
    </section>
  );
}
