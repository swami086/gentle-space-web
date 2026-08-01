type SpacesStaleBannerProps = {
  lastSyncedAt: string;
};

function describeStaleDate(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = date.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${day}, ${time}`;
}

export function SpacesStaleBanner({ lastSyncedAt }: SpacesStaleBannerProps) {
  return (
    <section className="px-6 lg:px-[var(--page-pad-x)]">
      <div
        role="status"
        className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm leading-relaxed text-[var(--ink-secondary)] shadow-[0_1px_0_rgba(255,255,255,0.04)]"
      >
        Listings may be outdated — last successful sync was{" "}
        <time className="font-medium text-[var(--ink)]" dateTime={lastSyncedAt}>
          {describeStaleDate(lastSyncedAt)} IST
        </time>{" "}
        (over 36 hours ago).
      </div>
    </section>
  );
}
