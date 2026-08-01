import { ThemeToggle } from "@/components/ThemeToggle";

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
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur">
      <div className="mx-auto flex min-h-[72px] max-w-[1120px] items-center justify-between gap-4 px-5 py-4 lg:px-10">
        <div className="min-w-0">
          {variant === "default" ? (
            <h1 className="truncate font-display text-[26px] font-semibold tracking-tight text-[var(--ink)] lg:text-[32px]">
              Spaces in Bangalore
            </h1>
          ) : null}
          {metaOverride ? (
            <p
              className={`truncate text-[13px] text-[var(--muted)] ${
                variant === "default" ? "mt-1.5" : ""
              }`}
            >
              {metaOverride}
            </p>
          ) : null}
        </div>

        <div className="shrink-0">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
