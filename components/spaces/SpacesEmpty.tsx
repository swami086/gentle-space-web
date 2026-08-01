export function SpacesEmpty() {
  return (
    <section className="px-6 pb-16 lg:px-[var(--page-pad-x)]">
      <div className="relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-8 py-16 text-center shadow-[0_1px_0_rgba(255,255,255,0.04),0_16px_40px_rgba(15,23,42,0.08)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(104,64,184,0.08),transparent_60%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/25 to-transparent"
        />
        <div className="relative mx-auto max-w-md">
          <p className="text-lg font-semibold text-[var(--ink)]">No spaces to show yet</p>
          <p className="mx-auto mt-3 text-sm leading-relaxed text-[var(--muted)]">
            We don&apos;t have listings to show right now. Share your brief and we&apos;ll help you
            find a space directly.
          </p>
        </div>
      </div>
    </section>
  );
}
