"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CronSettings } from "@/lib/types";

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

  async function runNow() {
    setPending(true);
    try {
      await fetch("/api/cycle/run", { method: "POST" });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <p>
        <strong>Cron:</strong> {settings.enabled ? "enabled" : "disabled"}
      </p>
      <p>
        <strong>Last run:</strong>{" "}
        {settings.lastRunAt ? new Date(settings.lastRunAt).toLocaleString() : "never"}
      </p>
      <button disabled={pending} onClick={toggle}>
        {settings.enabled ? "Disable cron" : "Enable cron"}
      </button>{" "}
      <button disabled={pending} onClick={runNow}>
        Run cycle now
      </button>
    </div>
  );
}
