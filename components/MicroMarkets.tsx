const MARKETS = [
  "Whitefield",
  "Outer Ring Road",
  "Koramangala",
  "Indiranagar",
  "HSR Layout",
  "Electronic City",
  "MG Road",
  "Sarjapur Road",
] as const;

export function MicroMarkets() {
  return (
    <section id="locations" className="px-6 py-20 lg:px-[160px]">
      <div className="max-w-[960px]">
        <p className="text-sm font-semibold">
          <span className="inline-flex rounded-full bg-[var(--surface-tint)] px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-dark)]">
            BANGALORE LOCATIONS
          </span>
        </p>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-[var(--ink)] lg:text-5xl">
          We cover all of Bangalore. These corridors see the most activity right now.
        </h2>

        <div className="mt-8 flex flex-wrap gap-3">
          {MARKETS.map((market) => (
            <span
              key={market}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--ink)]"
            >
              {market}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
