import type { ReactNode } from "react";
import { Clock } from "lucide-react";
import { scopeForSession } from "@/lib/auth/scope-interim";
import { getOrgSettings } from "@/lib/db/org-settings";
import { cn } from "@/lib/utils";
import { requireSession } from "@/lib/auth/dal";
import { Breadcrumb } from "@/components/Breadcrumb";
import { CommandPalette } from "@/components/CommandPalette";
import { RunNowButton } from "@/components/RunNowButton";
import { SidebarNav } from "@/components/SidebarNav";
import { UserMenu } from "@/components/UserMenu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopilotProvider } from "@/components/copilot/CopilotProvider";
import { CopilotFab } from "@/components/copilot/CopilotFab";
import { CopilotPanel } from "@/components/copilot/CopilotPanel";

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

  const settings = await getOrgSettings(await scopeForSession(session));
  // Same minimum tier as the Copilot route's requireApiRole("operator") gate (lib/auth/dal.ts) —
  // defense in depth, mirroring how SidebarNav/nav-config.ts already gate nav visibility by role.
  const canUseCopilot = session.role === "operator" || session.role === "admin";

  return (
    <CopilotProvider>
      <div className="mx-auto grid min-h-dvh max-w-[1400px] grid-cols-[220px_1fr]">
      <aside className="border-r border-border">
        <div className="px-4 py-4 text-sm font-semibold tracking-tight">ads-agent</div>
        <SidebarNav role={session.role} />
      </aside>
      <div className="flex flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border px-6">
          <Breadcrumb />
          <div className="flex items-center gap-4">
            <span className="hidden items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground sm:flex">
              <kbd>⌘</kbd>
              <kbd>K</kbd>
            </span>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span
                className={cn(
                  "inline-block size-2 rounded-full",
                  settings.cronEnabled ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
                aria-hidden
              />
              Cron: {settings.cronEnabled ? "on" : "off"}
              <span className="text-muted-foreground/60">
                · Last run {settings.lastRunAt ? new Date(settings.lastRunAt).toLocaleString() : "never"}
              </span>
            </div>
            <RunNowButton />
            <UserMenu email={session.email} role={session.role} />
          </div>
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
      <CommandPalette role={session.role} />
      {canUseCopilot && (
        <>
          <CopilotFab />
          <CopilotPanel />
        </>
      )}
    </div>
    </CopilotProvider>
  );
}
