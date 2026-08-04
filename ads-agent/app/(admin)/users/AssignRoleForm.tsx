"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { assignRoleAction } from "./actions";

const ROLES = ["admin", "operator", "viewer"] as const;

export function AssignRoleForm({ userId, currentRole }: { userId: string; currentRole: string | null }) {
  const [role, setRole] = useState(currentRole ?? "viewer");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await assignRoleAction(userId, role);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to assign role.");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="h-9 rounded-md border border-border bg-background px-2 text-sm"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <Button type="button" size="sm" disabled={pending} onClick={submit}>
        {pending ? "Saving…" : "Assign"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
