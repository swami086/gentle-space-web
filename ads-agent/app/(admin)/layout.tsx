import type { ReactNode } from "react";
import { Clock } from "lucide-react";
import { getCronSettings } from "@/lib/db/settings";
import { cn } from "@/lib/utils";
import { requireSession } from "@/lib/auth/dal";
import { RunNowButton } from "@/components/RunNowButton";
import { SidebarNav } from "@/components/SidebarNav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!session.role) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center gap-4 pt-8 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-accent">
              <Clock className="size-5 text-accent-foreground" strokeWidth={2} aria-hidden="true" />
            </span>
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-xl font-semibold text-foreground">
                Your account is pending approval
              </CardTitle>
              <CardDescription className="text-balance">
                Signed in as {session.email}. An admin needs to assign you a role from the Users
                page before you can access the dashboard.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pb-8 text-center text-xs text-muted-foreground">
            Refresh this page after your role is assigned.
          </CardContent>
        </Card>
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
