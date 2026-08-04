"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { visibleNavGroups, type MemberRole } from "@/lib/nav-config";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export function CommandPalette({ role }: { role: MemberRole | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!open) return null;

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  async function runCycleNow() {
    setOpen(false);
    await fetch("/api/cycle/run", { method: "POST" });
    router.refresh();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[20vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder="Jump to a page or run an action…" autoFocus />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup heading="Go to">
              {visibleNavGroups(role).flatMap((group) =>
                group.items.map((item) => (
                  <CommandItem key={item.href} value={item.label} onSelect={() => go(item.href)}>
                    <item.icon className="size-4" strokeWidth={2} />
                    {item.label}
                  </CommandItem>
                )),
              )}
            </CommandGroup>
            <CommandGroup heading="Actions">
              <CommandItem value="Run decision cycle now" onSelect={runCycleNow}>
                <RefreshCw className="size-4" strokeWidth={2} />
                Run decision cycle now
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
    </div>
  );
}
