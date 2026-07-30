import type { SyncRun } from "@/lib/listings/types";

const STALE_THRESHOLD_MS = 36 * 60 * 60 * 1000;
const IST: Intl.DateTimeFormatOptions = { timeZone: "Asia/Kolkata" };

export function isStaleSync(finishedAt: string | null | undefined): boolean {
  if (!finishedAt) return false;
  return Date.now() - new Date(finishedAt).getTime() > STALE_THRESHOLD_MS;
}

function describeSyncedAt(iso: string): string {
  const date = new Date(iso);
  const istNow = new Date(new Date().toLocaleString("en-US", IST));
  const istDate = new Date(date.toLocaleString("en-US", IST));
  const sameDay =
    istNow.getFullYear() === istDate.getFullYear() &&
    istNow.getMonth() === istDate.getMonth() &&
    istNow.getDate() === istDate.getDate();

  const time = date.toLocaleTimeString("en-IN", {
    ...IST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (sameDay) return `today ${time} IST`;

  const day = date.toLocaleDateString("en-IN", {
    ...IST,
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return `${day}, ${time} IST`;
}

type SpacesHeaderProps = {
  lastSync: SyncRun | null;
  sourceCount: number;
  metaOverride?: string;
  variant?: "default" | "minimal";
};

export function SpacesHeader({
  lastSync,
  sourceCount,
  metaOverride,
  variant = "default",
}: SpacesHeaderProps) {
  const syncedLabel = lastSync?.finishedAt
    ? `Last synced · ${describeSyncedAt(lastSync.finishedAt)} · ${sourceCount} source${sourceCount === 1 ? "" : "s"}`
    : "Last synced · not yet";

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
      <p className={`${variant === "default" ? "mt-2" : ""} text-sm text-[var(--muted)]`}>
        {metaOverride ?? syncedLabel}
      </p>
    </header>
  );
}
