const STALE_THRESHOLD_MS = 36 * 60 * 60 * 1000;

export function isStaleSync(finishedAt: string | null | undefined): boolean {
  if (!finishedAt) return false;
  return Date.now() - new Date(finishedAt).getTime() > STALE_THRESHOLD_MS;
}

type SpacesHeaderProps = {
  metaOverride?: string;
  variant?: "default" | "minimal";
};

export function SpacesHeader({ metaOverride, variant = "default" }: SpacesHeaderProps) {
  // Theme toggle lives in SiteHeader (spaces layout). This is the page title band only.
  return (
    <header
      className={`bg-[var(--bg)] px-5 lg:px-10 ${
        variant === "minimal" ? "pb-2 pt-6" : "pb-4 pt-8"
      }`}
    >
      <div className="mx-auto max-w-[1120px]">
        {variant === "default" ? (
          <h1 className="font-display text-[26px] font-semibold tracking-tight text-[var(--ink)] lg:text-[32px]">
            Spaces in Bangalore
          </h1>
        ) : null}
        {metaOverride ? (
          <p className={`${variant === "default" ? "mt-1.5" : ""} text-[13px] text-[var(--muted)]`}>
            {metaOverride}
          </p>
        ) : null}
      </div>
    </header>
  );
}
