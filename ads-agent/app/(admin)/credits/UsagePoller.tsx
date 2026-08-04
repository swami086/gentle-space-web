"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 15_000;

export function UsagePoller() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
