"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CronSettings } from "@/lib/types";
import { RunNowButton } from "@/components/RunNowButton";
import { Switch } from "@/components/ui/switch";

export function SettingsForm({ settings }: { settings: CronSettings }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function toggle() {
    setPending(true);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !settings.enabled }),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Run decision cycle on a schedule</p>
          <p className="text-sm text-muted-foreground">
            Last run: {settings.lastRunAt ? new Date(settings.lastRunAt).toLocaleString() : "never"}
          </p>
        </div>
        <Switch checked={settings.enabled} disabled={pending} onCheckedChange={toggle} />
      </div>
      <RunNowButton />
    </div>
  );
}
