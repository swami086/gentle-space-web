"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RunNowButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

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
    <Button size="sm" variant="secondary" disabled={pending} onClick={runNow} className="w-fit">
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
      Run now
    </Button>
  );
}
