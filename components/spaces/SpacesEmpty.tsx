export function SpacesEmpty() {
  return (
    <section className="px-6 pb-16 lg:px-[var(--page-pad-x)]">
      <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border)] bg-[var(--surface)] px-8 py-16 text-center">
        <p className="text-lg font-semibold text-[var(--ink)]">No spaces to show yet</p>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--muted)]">
          Sync hasn&apos;t produced listings yet. Check back after the next morning sync, or share
          your brief and we&apos;ll help you find a space directly.
        </p>
      </div>
    </section>
  );
}
