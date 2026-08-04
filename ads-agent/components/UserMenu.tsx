"use client";

import { LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MemberRole } from "@/lib/nav-config";

function initials(email: string): string {
  const name = email.split("@")[0] ?? email;
  const parts = name.split(/[._-]/).filter(Boolean);
  const chars = parts.length >= 2 ? [parts[0][0], parts[1][0]] : [name[0] ?? "", name[1] ?? ""];
  return chars.join("").toUpperCase();
}

export function UserMenu({ email, role }: { email: string; role: MemberRole }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {initials(email)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="font-normal text-foreground">{email}</span>
          <Badge variant="outline" className="w-fit capitalize">
            {role}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/api/auth/signout" className="text-destructive">
            <LogOut className="size-4" strokeWidth={2} />
            Sign out
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
