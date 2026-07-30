export function About() {
  const pills = ["Verified before you tour", "Legal and paperwork through close", "Bangalore-wide coverage"];

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
            Why companies and owners work with Gentle Space
          </h2>
          <p className="mt-6 max-w-2xl text-base leading-8 text-[var(--muted)] lg:text-lg">
            Most leases run into trouble in the fine print. We check it before you tour a
            property, then stay on the deal through legal and handover. Property owners get the
            same coverage from the other side: a tenant we&apos;ve actually vetted, and a close we
            manage end to end.
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
          <h3 className="text-xl font-semibold tracking-tight">How our fee works</h3>
          <p className="mt-4 text-sm leading-7 text-[var(--on-accent)]/90">
            Standard requirements cost you nothing. A highly customised search outside our
            existing network carries a fixed fee, agreed upfront.
          </p>
        </aside>
      </div>
    </section>
  );
}
