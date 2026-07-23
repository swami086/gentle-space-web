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
  const row1 = MARKETS.slice(0, 4);
  const row2 = MARKETS.slice(4);

  return (
    <section id="locations" className="bg-[var(--surface)] px-6 py-[72px] lg:px-[160px]">
      <div className="mx-auto flex max-w-[960px] flex-col items-center gap-10 text-center">
        <div className="flex flex-col items-center gap-3">
          <p className="text-[13px] font-semibold uppercase tracking-[1.2px] text-[var(--accent)]">
            BANGALORE LOCATIONS
          </p>
          <h2 className="max-w-[640px] text-[28px] font-semibold leading-[1.3] tracking-tight text-[var(--ink)] lg:text-[30px]">
            Office and commercial space across Bangalore’s main corridors
          </h2>
        </div>

        <div className="flex w-full flex-col items-center gap-4">
          {[row1, row2].map((row, i) => (
            <div key={i} className="flex flex-wrap justify-center gap-4">
              {row.map((market) => (
                <span
                  key={market}
                  className="rounded-[var(--radius-lg)] bg-[var(--bg)] px-6 py-3 text-[15px] font-medium text-[var(--ink-secondary)]"
                >
                  {market}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
