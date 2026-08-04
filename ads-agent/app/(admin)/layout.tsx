import type { ReactNode } from "react";
import { getCronSettings } from "@/lib/db/settings";
import { cn } from "@/lib/utils";
import { requireSession } from "@/lib/auth/dal";
import { RunNowButton } from "@/components/RunNowButton";
import { SidebarNav } from "@/components/SidebarNav";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!session.role) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6 text-center">
        <div className="flex max-w-md flex-col gap-2">
          <p className="text-lg font-semibold text-foreground">Your account is pending approval</p>
          <p className="text-sm text-muted-foreground">
            Signed in as {session.email}. An admin needs to assign you a role from the Users
            page before you can access the dashboard.
          </p>
        </div>
      </div>
    );
  }

  const settings = await getCronSettings();

  return (
    <div className="mx-auto grid min-h-dvh max-w-[1400px] grid-cols-[220px_1fr]">
      <aside className="border-r border-border">
        <div className="px-4 py-4 text-sm font-semibold tracking-tight">ads-agent</div>
        <SidebarNav />
      </aside>
      <div className="flex flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border px-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span
              className={cn(
                "inline-block size-2 rounded-full",
                settings.enabled ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
              aria-hidden
            />
            Cron: {settings.enabled ? "on" : "off"}
            <span className="text-muted-foreground/60">
              · Last run {settings.lastRunAt ? new Date(settings.lastRunAt).toLocaleString() : "never"}
            </span>
          </div>
          <RunNowButton />
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
