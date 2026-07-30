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
  return (
    <header
      className={`bg-[var(--bg)] px-6 lg:px-[var(--page-pad-x)] ${
        variant === "minimal" ? "pb-2 pt-10" : "pb-6 pt-12"
      }`}
    >
      {variant === "default" ? (
        <h1 className="text-3xl font-bold text-[var(--ink)] lg:text-[40px]">
          Spaces in Bangalore
        </h1>
      ) : null}
      {metaOverride ? (
        <p className={`${variant === "default" ? "mt-2" : ""} text-sm text-[var(--muted)]`}>
          {metaOverride}
        </p>
      ) : null}
    </header>
  );
}
