# ads-agent Admin Dashboard v2 (Linear-style Redesign) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: This plan is organized into **waves** for parallel
> execution (up to 8 subagents at once), a deliberate deviation from
> `superpowers:subagent-driven-development`'s default "never dispatch implementers in parallel" rule —
> safe here because every task within a wave owns a disjoint set of files (see each wave's file-ownership
> note). This mirrors the same deviation already used successfully in this repo's
> [`2026-08-03-ads-agent-admin-dashboard.md`](2026-08-03-ads-agent-admin-dashboard.md) plan. Use
> `superpowers:dispatching-parallel-agents` to dispatch all tasks in a wave together (multiple Task tool
> calls in the same message = parallel). Each implementer subagent follows
> `superpowers:test-driven-development` for the two tasks with a Vitest cycle (Tasks 2 and 6); every
> other task is scaffolding/presentation and is verified manually per its own steps instead (same
> convention as the v1 plan). Run the task-reviewer gate (spec compliance + code quality) on every task
> as it completes; do **not** dispatch the next wave until every task in the current wave has passed
> review — later waves import files earlier waves create. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Redesign `ads-agent`'s admin dashboard toward a flatter, Linear-inspired UI — a role-aware
grouped/collapsible sidebar, a breadcrumb top bar, a ⌘K command palette, and a working sign-out — per
[`docs/superpowers/specs/2026-08-04-ads-agent-admin-dashboard-v2-design.md`](../specs/2026-08-04-ads-agent-admin-dashboard-v2-design.md).

**Architecture:** A new `lib/nav-config.ts` becomes the single source of truth for sidebar structure and
role gating, consumed by a rewritten `SidebarNav`, a new `CommandPalette`, and a new `Breadcrumb`. A new
`UserMenu` (Radix dropdown) adds a working sign-out that spans both `ads-agent` and `auth-service` (the
only way to correctly end the dual-cookie session this repo already uses). `(admin)/layout.tsx` becomes
the single integration point wiring all of the above together. Five existing pages then drop their
outer `Card` wrapper now that the breadcrumb carries the page heading.

**Tech Stack:** Next.js 15.5.21, React 19, TypeScript, Tailwind v4, existing shadcn-style
`components/ui/*` primitives, `lucide-react`, Vitest — plus two new dependencies: `cmdk` and
`@radix-ui/react-dropdown-menu`.

## Global Constraints

- **Nav structure and role thresholds are exact** — copy verbatim, do not rename or reorder:
  `Workspace` (`/` Overview `minRole: viewer`, `/campaigns` Campaigns `minRole: operator`, `/proposals`
  Proposals `minRole: operator`) and `Admin` (`/credits` Usage & Credits `minRole: admin`, `/users`
  Users `minRole: admin`, `/settings` Settings `minRole: admin`). (Spec Goal 1, Architecture.)
- **No route/URL changes.** Every `href` above is identical to today's; no `app/api/**` route changes
  except the two new signout routes this plan adds. (Spec Non-goals.)
- **Role type and rank are already defined** in `ads-agent/lib/auth/dal.ts`: `MemberRole = "admin" |
  "operator" | "viewer"`, `ROLE_RANK = { viewer: 1, operator: 2, admin: 3 }`. `lib/nav-config.ts` reuses
  this exact type (re-export or duplicate the literal union, do not invent a different shape) and the
  same rank ordering.
- **Accent color values are unchanged** (`#6840b8` light / `#8b6fd1` dark, already in
  `app/globals.css`) — only the active-sidebar-row treatment changes (solid fill → 2px left border +
  brighter text). No new color tokens are introduced anywhere in this plan. (Spec Goal 5.)
- **No new CSS variables.** Every new component (`command.tsx`, `dropdown-menu.tsx`, `CommandPalette`,
  `UserMenu`) uses only tokens that already exist in `app/globals.css` today: `bg-card`,
  `text-card-foreground`, `bg-accent`, `text-accent-foreground`, `border-border`, `bg-muted`,
  `text-muted-foreground`, `text-destructive`. There is no `--popover` token in this codebase — use
  `bg-card`/`text-card-foreground` wherever a shadcn reference implementation would say `popover`.
- **Dark mode via `prefers-color-scheme` only** — no manual toggle. Both themes get every change in
  this plan equally. (Spec Non-goals, Goal 7.)
- **Do not add dependencies with hand-picked version numbers.** Every new package is installed via
  `npm install <name>` so npm resolves and pins the actual latest version — never hand-type a guessed
  semver range. (Repo convention, v1 plan's Global Constraints.)
- **This repo's Next.js has breaking changes vs. training-data conventions (per `AGENTS.md`).** Dynamic
  route `params` and `searchParams` are `Promise`-typed in Next 15.5.21 — every task below that touches
  a page component with either preserves the existing `Promise<...>` signature unchanged; verify against
  `node_modules/next/dist/docs/` before writing new dynamic-route code if anything looks off.
- **Follow this repo's existing conventions exactly:** colocated `*.test.ts` files; `vi.hoisted(() => ({
  ...vi.fn() }))` + `vi.mock("@/module", () => ({ ... }))` for mocking named exports (see
  `auth-service/app/api/refresh/route.test.ts`, `auth-service/app/bridge/route.test.ts`); `@/*` path
  alias in both apps; `ForbiddenNotice` + `requireRole(min)` guard pattern already used on every admin
  page (unchanged by this plan — no task removes or weakens an existing role check).
- **Deliberate scope limit on sign-out (ponytail):** Task 7's `ads-agent`-side cookie clear is
  host-only (correct for local dev, where `gs_session` has no `Domain` attribute). In production
  (`COOKIE_DOMAIN` set, shared-domain cookie), this plan does not thread `COOKIE_DOMAIN` into
  `ads-agent` to domain-match the clear — the stale shared-domain `gs_session` is left to its natural
  ≤20-minute expiry instead. Ceiling: a signed-out prod user's `gs_session` JWT could still verify for
  up to 20 more minutes if somehow replayed (the `auth-service`-side refresh token is already revoked in
  Task 6, so it cannot be renewed). Upgrade path: pass `COOKIE_DOMAIN` to `ads-agent` too and clear with
  a matching `Domain` attribute, mirroring `auth-service/lib/cookies.ts`'s `authCookieBase`, if this gap
  ever matters in practice.
- **Deliberate scope trim on the breadcrumb (found during planning, not in the original spec):** the
  spec's Header section said `/proposals/[id]`'s breadcrumb would append the proposal's `kind` as a 3rd
  segment. `(admin)/layout.tsx` is two segments above `proposals/[id]/page.tsx` and has no clean,
  verified way to receive that page's dynamic `params` without a larger Next.js parallel-routes/slots
  change this spec never scoped. Task 9's `Breadcrumb` instead does the same longest-prefix match
  `SidebarNav` already uses for its own active-link highlighting, so `/proposals/123` shows "Workspace /
  Proposals" (2 segments, matching every other page) — the proposal's specific `kind` is still visible
  right below it, in that page's own (unchanged) `CardTitle`. Flagged for the human's awareness; not
  silently different from what was approved.

---

## Parallelization Plan

```text
Wave 1 (3 parallel)  Task 1 — Install cmdk + @radix-ui/react-dropdown-menu
                     Task 2 — lib/nav-config.ts (NAV_GROUPS + visibleNavGroups), TDD
                     Task 6 — auth-service: POST-equivalent signout route, TDD
                        ↓ (all 3 must pass review first)
Wave 2 (3 parallel)  Task 3 — components/ui/command.tsx (cmdk wrapper)
                     Task 4 — components/ui/dropdown-menu.tsx (Radix wrapper)
                     Task 8 — SidebarNav.tsx rewrite (grouped, collapsible, role-filtered)
                        ↓ (all 3 must pass review first)
Wave 3 (2 parallel)  Task 5 — CommandPalette.tsx
                     Task 7 — UserMenu.tsx + ads-agent signout route
                        ↓ (both must pass review first)
Wave 4 (solo)        Task 9 — (admin) layout.tsx integration (breadcrumb, mount everything)
                        ↓ (must pass review first)
Wave 5 (5 parallel)  Task 10 — Overview: flat KPI row
                     Task 11 — Campaigns: drop outer Card
                     Task 12 — Proposals list: drop outer Card
                     Task 13 — Users: drop outer Cards
                     Task 14 — Credits: drop Cards around listing tables only
                        ↓ (all 5 must pass review first)
Wave 6 (solo)        Task 15 — Full manual verification pass
```

Real max concurrency here is 5 (Wave 5), inside the requested ≤8 ceiling — the dependency graph for a
single shared integration file (`layout.tsx`, Task 9 is necessarily solo) and a two-hop cross-service
sign-out chain (Task 6 → Task 7) doesn't support more genuine parallelism than that without giving some
task a broken, untestable interim state. Each task's **Interfaces** block states exactly what it
consumes from an earlier wave and produces for a later one; siblings within a wave touch disjoint files
and never need each other's output.

**Skills:** every implementation task below reads and follows `~/.cursor/skills/senior-frontend/SKILL.md`
(React/Next.js/TypeScript/Tailwind conventions, accessibility). Tasks with real interaction-design
stakes (command palette, sidebar collapse, user menu, breadcrumb) additionally follow
`~/.cursor/skills/ui-ux-design-expert/SKILL.md` (Nielsen heuristics — escape/undo, recognition over
recall, shortcuts for experts). Tasks that touch shared visual density/tokens (the sidebar's active-row
treatment, all five Wave 5 Card removals) additionally follow
`~/.cursor/skills/ui-design-system/SKILL.md` (token/consistency discipline). `image-to-code` was
considered and excluded — it's scoped to image-first hero/landing-page generation (per its own
frontmatter), which doesn't apply to a token-driven admin-dashboard restyle with no hero and no
generated mockups (same conclusion the spec's design-system note already reached for
`design-taste-frontend`).

---

### Task 1: Install `cmdk` and `@radix-ui/react-dropdown-menu`

**Files:**
- Modify: `ads-agent/package.json` (via `npm install`, not hand-edited)
- Modify: `ads-agent/package-lock.json` (via `npm install`)

**Interfaces:**
- Consumes: nothing.
- Produces: the `cmdk` package (consumed by Task 3) and `@radix-ui/react-dropdown-menu` (consumed by
  Task 4) become resolvable imports for every later task in this plan.

**Skills:** senior-frontend.

No independent logic to TDD — verify manually per the steps below.

- [ ] **Step 1: Install the two dependencies**

Run inside `ads-agent/`:

```bash
npm install cmdk @radix-ui/react-dropdown-menu
```

Expected: `package.json`'s `dependencies` gains two new entries with whatever versions npm resolved — do
not hand-edit version numbers.

- [ ] **Step 2: Verify the app still builds**

Run: `npm run build`
Expected: build succeeds with no type errors (nothing imports either package yet — this task only adds
them to `package.json`/`package-lock.json`).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(ads-agent): add cmdk and @radix-ui/react-dropdown-menu"
```

---

### Task 2: `lib/nav-config.ts` — nav groups + role-filtering

**Files:**
- Create: `ads-agent/lib/nav-config.ts`
- Create: `ads-agent/lib/nav-config.test.ts`

**Interfaces:**
- Consumes: `LucideIcon` type, `ClipboardList`, `CreditCard`, `LayoutDashboard`, `Megaphone`, `Settings`,
  `Users` from `lucide-react` (existing dependency).
- Produces: `MemberRole` type (`"admin" | "operator" | "viewer"`), `NavItem` type
  (`{ href: string; label: string; icon: LucideIcon; minRole: MemberRole }`), `NavGroup` type
  (`{ key: string; label: string; items: NavItem[] }`), `NAV_GROUPS: NavGroup[]`, and
  `visibleNavGroups(role: MemberRole | null, groups?: NavGroup[]): NavGroup[]` — all consumed by Task 5
  (CommandPalette), Task 8 (SidebarNav), and Task 9 (Breadcrumb inside layout.tsx).

**Skills:** senior-frontend, ui-ux-design-expert (recognition-over-recall: a viewer should never see a
nav item it can't open).

- [ ] **Step 1: Write the failing tests**

Create `ads-agent/lib/nav-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NAV_GROUPS, visibleNavGroups } from "./nav-config";

describe("visibleNavGroups", () => {
  it("shows only Overview in Workspace, and no Admin group, for a viewer", () => {
    const groups = visibleNavGroups("viewer");
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("workspace");
    expect(groups[0].items.map((item) => item.label)).toEqual(["Overview"]);
  });

  it("shows all of Workspace but no Admin group for an operator", () => {
    const groups = visibleNavGroups("operator");
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("workspace");
    expect(groups[0].items.map((item) => item.label)).toEqual(["Overview", "Campaigns", "Proposals"]);
  });

  it("shows both groups in full for an admin", () => {
    const groups = visibleNavGroups("admin");
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map((item) => item.label)).toEqual(["Overview", "Campaigns", "Proposals"]);
    expect(groups[1].items.map((item) => item.label)).toEqual(["Usage & Credits", "Users", "Settings"]);
  });

  it("returns no groups at all for a null role", () => {
    expect(visibleNavGroups(null)).toEqual([]);
  });

  it("NAV_GROUPS itself has the two groups and their real hrefs, unfiltered", () => {
    expect(NAV_GROUPS.map((g) => g.key)).toEqual(["workspace", "admin"]);
    expect(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href))).toEqual([
      "/",
      "/campaigns",
      "/proposals",
      "/credits",
      "/users",
      "/settings",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- nav-config`
Expected: FAIL with "Failed to resolve import ./nav-config" or similar module-not-found error.

- [ ] **Step 3: Write the implementation**

Create `ads-agent/lib/nav-config.ts`:

```ts
import {
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  Megaphone,
  Settings as SettingsIcon,
  Users,
  type LucideIcon,
} from "lucide-react";

export type MemberRole = "admin" | "operator" | "viewer";

export type NavItem = { href: string; label: string; icon: LucideIcon; minRole: MemberRole };
export type NavGroup = { key: string; label: string; items: NavItem[] };

const ROLE_RANK: Record<MemberRole, number> = { viewer: 1, operator: 2, admin: 3 };

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "workspace",
    label: "Workspace",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard, minRole: "viewer" },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone, minRole: "operator" },
      { href: "/proposals", label: "Proposals", icon: ClipboardList, minRole: "operator" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    items: [
      { href: "/credits", label: "Usage & Credits", icon: CreditCard, minRole: "admin" },
      { href: "/users", label: "Users", icon: Users, minRole: "admin" },
      { href: "/settings", label: "Settings", icon: SettingsIcon, minRole: "admin" },
    ],
  },
];

export function visibleNavGroups(role: MemberRole | null, groups: NavGroup[] = NAV_GROUPS): NavGroup[] {
  if (!role) return [];
  const rank = ROLE_RANK[role];
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => ROLE_RANK[item.minRole] <= rank) }))
    .filter((group) => group.items.length > 0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- nav-config`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/nav-config.ts lib/nav-config.test.ts
git commit -m "feat(ads-agent): add role-filtered nav-group config"
```

---

### Task 6: `auth-service` — signout route (revokes refresh token, ends Auth.js session)

**Files:**
- Create: `auth-service/app/api/session/signout/route.ts`
- Create: `auth-service/app/api/session/signout/route.test.ts`

**Interfaces:**
- Consumes: `signOut` from `@/auth` (existing, already exported by `auth-service/auth.ts`, currently
  unused); `revokeRefreshToken` from `@/lib/db/refresh-tokens` (existing, currently unused);
  `safeReturnTo` from `@/lib/safe-redirect` (existing).
- Produces: `GET /api/session/signout?return_to=<url>` — consumed by Task 7's `ads-agent` signout route,
  which redirects the browser here as the second hop of the sign-out chain.

**Skills:** senior-frontend (Next.js Route Handler conventions — this task has no UI).

Why this exists (context the implementer needs, not in the brief otherwise): `ads-agent` and
`auth-service` use a **dual-cookie** scheme — `gs_session` (short-lived JWT, read by
`ads-agent/lib/auth/dal.ts`) and `gs_refresh` (long-lived opaque token, host-only to `auth-service`,
used by `auth-service/app/api/refresh/route.ts` to mint new `gs_session`s). `auth-service`'s own Auth.js
session cookie is a *third*, separate cookie. A correct sign-out has to reach all three; this task
handles the two `auth-service`-owned pieces (revoke `gs_refresh` server-side + clear both cookies +
clear the Auth.js session). `gs_session` itself is cleared by `ads-agent`'s own route in Task 7, because
in local dev it's host-only to `ads-agent`'s origin (`auth-service` cannot clear it).

- [ ] **Step 1: Write the failing tests**

Create `auth-service/app/api/session/signout/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { signOut, revokeRefreshToken } = vi.hoisted(() => ({
  signOut: vi.fn(),
  revokeRefreshToken: vi.fn(),
}));

vi.mock("@/auth", () => ({ signOut }));
vi.mock("@/lib/db/refresh-tokens", () => ({ revokeRefreshToken }));

process.env.COOKIE_DOMAIN = "localhost";

import { GET } from "./route";

beforeEach(() => {
  signOut.mockReset();
  revokeRefreshToken.mockReset();
  signOut.mockResolvedValue(undefined);
});

function requestWithRefreshCookie(cookieValue: string | null, returnTo?: string) {
  const url = new URL("http://localhost:3040/api/session/signout");
  if (returnTo) url.searchParams.set("return_to", returnTo);
  const headers = new Headers();
  if (cookieValue) headers.set("cookie", `gs_refresh=${cookieValue}`);
  return new Request(url, { headers });
}

describe("GET /api/session/signout", () => {
  it("revokes the refresh token when a gs_refresh cookie is present", async () => {
    await GET(requestWithRefreshCookie("raw-refresh-token"));
    expect(revokeRefreshToken).toHaveBeenCalledWith("raw-refresh-token");
  });

  it("does not call revokeRefreshToken when there is no gs_refresh cookie", async () => {
    await GET(requestWithRefreshCookie(null));
    expect(revokeRefreshToken).not.toHaveBeenCalled();
  });

  it("calls next-auth's signOut with redirect disabled", async () => {
    await GET(requestWithRefreshCookie(null));
    expect(signOut).toHaveBeenCalledWith({ redirect: false });
  });

  it("clears the gs_refresh cookie and redirects to the safe return_to destination", async () => {
    const res = await GET(requestWithRefreshCookie("raw-refresh-token", "http://localhost:3040/login"));
    expect(res.headers.get("set-cookie")).toContain("gs_refresh=;");
    expect(res.headers.get("location")).toBe("http://localhost:3040/login");
  });

  it("falls back to / when return_to is missing or unsafe", async () => {
    const res = await GET(requestWithRefreshCookie(null, "https://evil.example.com/"));
    expect(res.headers.get("location")).toBe("http://localhost:3040/");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- session/signout`
Expected: FAIL with "Failed to resolve import ./route" or similar module-not-found error.

- [ ] **Step 3: Write the implementation**

Create `auth-service/app/api/session/signout/route.ts`:

```ts
import { NextResponse } from "next/server";
import { signOut } from "@/auth";
import { revokeRefreshToken } from "@/lib/db/refresh-tokens";
import { safeReturnTo } from "@/lib/safe-redirect";

function extractRefreshCookie(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)gs_refresh=([^;]+)/);
  return match ? match[1] : null;
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const cookieDomain = process.env.COOKIE_DOMAIN ?? "localhost";
  const destination = safeReturnTo(url.searchParams.get("return_to"), url.origin, cookieDomain);

  const rawRefresh = extractRefreshCookie(req);
  if (rawRefresh) await revokeRefreshToken(rawRefresh);

  // redirect: false — this is a plain Route Handler, not a Server Action; we build our own
  // NextResponse below. signOut() still clears Auth.js's own session cookie via next/headers,
  // which Route Handlers (like Server Actions) can mutate for the response being built.
  await signOut({ redirect: false });

  const res = NextResponse.redirect(destination);
  res.cookies.set("gs_refresh", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- session/signout`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add app/api/session/signout/route.ts app/api/session/signout/route.test.ts
git commit -m "feat(auth-service): add signout route (revokes refresh token, clears Auth.js session)"
```

---

### Task 3: `components/ui/command.tsx` — cmdk wrapper

**Files:**
- Create: `ads-agent/components/ui/command.tsx`

**Interfaces:**
- Consumes: `Command` from `cmdk` (Task 1); `cn` from `@/lib/utils` (existing).
- Produces: `Command`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem` from
  `@/components/ui/command` — consumed by Task 5 (CommandPalette).

**Skills:** senior-frontend, ui-design-system (token consistency — reuses existing `bg-card`/`bg-accent`
tokens, introduces none).

No independent logic to TDD — presentational primitives. Verify manually.

- [ ] **Step 1: Create `ads-agent/components/ui/command.tsx`**

```tsx
"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-lg bg-card text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3">
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <CommandPrimitive.Input
        className={cn(
          "flex h-11 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn("max-h-80 overflow-y-auto overflow-x-hidden p-1", className)}
      {...props}
    />
  );
}

function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty className="py-6 text-center text-sm text-muted-foreground" {...props} />;
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem };
```

- [ ] **Step 2: Verify manually**

Run: `npm run build`
Expected: build succeeds — nothing imports this file yet (Task 5 does), so this step just confirms
`cmdk`'s types resolve and there are no syntax errors.

- [ ] **Step 3: Commit**

```bash
git add components/ui/command.tsx
git commit -m "feat(ads-agent): add cmdk-based Command UI primitives"
```

---

### Task 4: `components/ui/dropdown-menu.tsx` — Radix wrapper

**Files:**
- Create: `ads-agent/components/ui/dropdown-menu.tsx`

**Interfaces:**
- Consumes: `@radix-ui/react-dropdown-menu` (Task 1); `cn` from `@/lib/utils` (existing).
- Produces: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`,
  `DropdownMenuLabel`, `DropdownMenuSeparator` from `@/components/ui/dropdown-menu` — consumed by
  Task 7 (UserMenu).

**Skills:** senior-frontend, ui-design-system (token consistency).

No independent logic to TDD — presentational primitives. Verify manually.

- [ ] **Step 1: Create `ads-agent/components/ui/dropdown-menu.tsx`**

```tsx
"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-56 overflow-hidden rounded-md border border-border bg-card p-1 text-card-foreground shadow-md",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
};
```

- [ ] **Step 2: Verify manually**

Run: `npm run build`
Expected: build succeeds — nothing imports this file yet (Task 7 does).

- [ ] **Step 3: Commit**

```bash
git add components/ui/dropdown-menu.tsx
git commit -m "feat(ads-agent): add Radix-based DropdownMenu UI primitives"
```

---

### Task 8: `SidebarNav.tsx` rewrite — grouped, collapsible, role-filtered

**Files:**
- Modify: `ads-agent/components/SidebarNav.tsx`

**Interfaces:**
- Consumes: `visibleNavGroups`, `MemberRole` from `@/lib/nav-config` (Task 2); `cn` from `@/lib/utils`
  (existing).
- Produces: `SidebarNav({ role }: { role: MemberRole | null })` — the signature changes from today's
  no-props version; consumed by Task 9 (layout.tsx), which must pass `session.role`.

**Skills:** senior-frontend, ui-ux-design-expert (collapse affordance, active-state legibility),
ui-design-system (active-row accent treatment).

No independent logic to TDD — presentational, role-filtering logic itself is already tested in Task 2.
Verify manually.

- [ ] **Step 1: Replace `ads-agent/components/SidebarNav.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { visibleNavGroups, type MemberRole, type NavGroup } from "@/lib/nav-config";

function useGroupOpen(key: string): [boolean, () => void] {
  const storageKey = `ads-agent:nav-group:${key}`;
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored !== null) setOpen(stored === "1");
  }, [storageKey]);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      window.localStorage.setItem(storageKey, next ? "1" : "0");
      return next;
    });
  }

  return [open, toggle];
}

function NavGroupSection({ group, pathname }: { group: NavGroup; pathname: string }) {
  const [open, toggle] = useGroupOpen(group.key);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1 px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {group.label}
      </button>
      {open &&
        group.items.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 border-l-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="size-4" strokeWidth={2} />
              {label}
            </Link>
          );
        })}
    </div>
  );
}

export function SidebarNav({ role }: { role: MemberRole | null }) {
  const pathname = usePathname();
  const groups = visibleNavGroups(role);

  return (
    <nav className="flex flex-col gap-3 p-3">
      {groups.map((group) => (
        <NavGroupSection key={group.key} group={group} pathname={pathname} />
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Verify manually**

Run: `npm run build`
Expected: build FAILS — `(admin)/layout.tsx` (Task 9, not yet run) still calls `<SidebarNav />` with no
`role` prop, which now no longer type-checks. This is expected at this point in the plan; Task 9 fixes
the call site. Confirm the *only* error is the missing `role` prop on that one call site (no other type
errors), then proceed to commit anyway — this task's own file is correct and self-contained per its
Interfaces contract.

- [ ] **Step 3: Commit**

```bash
git add components/SidebarNav.tsx
git commit -m "feat(ads-agent): rewrite SidebarNav as grouped, collapsible, role-filtered"
```

---

### Task 5: `CommandPalette.tsx`

**Files:**
- Create: `ads-agent/components/CommandPalette.tsx`

**Interfaces:**
- Consumes: `visibleNavGroups`, `MemberRole` from `@/lib/nav-config` (Task 2); `Command`,
  `CommandEmpty`, `CommandGroup`, `CommandInput`, `CommandItem`, `CommandList` from
  `@/components/ui/command` (Task 3).
- Produces: `CommandPalette({ role }: { role: MemberRole | null })` — consumed by Task 9 (layout.tsx).

**Skills:** senior-frontend, ui-ux-design-expert (heuristic 3 "user control and freedom" — Escape and
backdrop-click both close it; heuristic 7 "flexibility and efficiency" — ⌘K is the expert shortcut).

No independent logic to TDD — presentational, its data source (`visibleNavGroups`) is already tested.
Verify manually.

- [ ] **Step 1: Create `ads-agent/components/CommandPalette.tsx`**

```tsx
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
```

- [ ] **Step 2: Verify manually**

Run: `npm run build`
Expected: build succeeds — nothing imports this file yet (Task 9 does).

- [ ] **Step 3: Commit**

```bash
git add components/CommandPalette.tsx
git commit -m "feat(ads-agent): add cmdk-based CommandPalette (nav + run-cycle-now)"
```

---

### Task 7: `UserMenu.tsx` + `ads-agent` signout route

**Files:**
- Create: `ads-agent/components/UserMenu.tsx`
- Create: `ads-agent/app/api/auth/signout/route.ts`

**Interfaces:**
- Consumes: `MemberRole` from `@/lib/nav-config` (Task 2); `DropdownMenu`, `DropdownMenuContent`,
  `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuTrigger` from
  `@/components/ui/dropdown-menu` (Task 4); `Badge` from `@/components/ui/badge` (existing); `GET
  /api/session/signout` on `auth-service` (Task 6, must be merged for this task's end-to-end
  verification step to actually work — see Step 3).
- Produces: `UserMenu({ email, role }: { email: string; role: MemberRole })` — consumed by Task 9
  (layout.tsx). `GET /api/auth/signout` on `ads-agent`'s own origin — the first hop of the sign-out
  chain, which `UserMenu`'s "Sign out" link points to.

**Skills:** senior-frontend, ui-ux-design-expert (recognition — email + role visible before the
destructive action; the item is styled as destructive per heuristic 5 "error prevention").

No independent logic to TDD — presentational component + a thin redirect route with no branching.
Verify manually.

- [ ] **Step 1: Create `ads-agent/app/api/auth/signout/route.ts`**

```ts
import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  const authServiceUrl = process.env.AUTH_SERVICE_URL;
  if (!authServiceUrl) throw new Error("AUTH_SERVICE_URL is not set");

  const destination = new URL("/api/session/signout", authServiceUrl);
  destination.searchParams.set("return_to", new URL("/login", authServiceUrl).toString());

  const res = NextResponse.redirect(destination);
  // ponytail: host-only clear — correct for local dev, where gs_session has no Domain attribute.
  // See this plan's Global Constraints for the documented prod-only limitation and upgrade path.
  res.cookies.set("gs_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
```

- [ ] **Step 2: Create `ads-agent/components/UserMenu.tsx`**

```tsx
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
```

- [ ] **Step 3: Verify manually**

Run: `npm run build`
Expected: build succeeds — nothing imports either new file yet (Task 9 does).

If Task 6 has already merged, additionally verify the full chain end to end once Task 9 has landed
(this specific check can also happen as part of Task 15's final pass if Task 9 isn't merged yet): sign
in, click the avatar → Sign out, confirm the browser lands on `auth-service`'s `/login` page, and that
revisiting `http://localhost:3040/bridge` afterward does **not** silently re-authenticate (it should
show the Google sign-in screen again, not skip straight through) — this is the check that proves the
Auth.js session was actually ended, not just the local `gs_session` cookie.

- [ ] **Step 4: Commit**

```bash
git add components/UserMenu.tsx "app/api/auth/signout/route.ts"
git commit -m "feat(ads-agent): add UserMenu with working cross-service sign-out"
```

---

### Task 9: `(admin)/layout.tsx` integration — breadcrumb, mount everything

**Files:**
- Modify: `ads-agent/app/(admin)/layout.tsx`
- Create: `ads-agent/components/Breadcrumb.tsx`

**Interfaces:**
- Consumes: `NAV_GROUPS` from `@/lib/nav-config` (Task 2); `SidebarNav` from `@/components/SidebarNav`
  (Task 8, new `role` prop); `CommandPalette` from `@/components/CommandPalette` (Task 5); `UserMenu`
  from `@/components/UserMenu` (Task 7); `session.role`, `session.email` from `requireSession()`
  (existing, unchanged).
- Produces: every page under `app/(admin)/**` now renders inside a shell with a breadcrumb, a working
  ⌘K palette, and a user menu — nothing new is exported for later tasks to import (this is the plan's
  integration point, not a library).

**Skills:** senior-frontend, ui-ux-design-expert (this is the one task that has to make four
independently-built pieces feel coherent together).

No independent logic to TDD — presentational integration. Verify manually.

- [ ] **Step 1: Create `ads-agent/components/Breadcrumb.tsx`**

```tsx
"use client";

import { usePathname } from "next/navigation";
import { NAV_GROUPS } from "@/lib/nav-config";

export function Breadcrumb() {
  const pathname = usePathname();

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const matches = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
      if (matches) {
        return (
          <span className="text-sm font-medium text-foreground">
            {item.href === "/" ? item.label : `${group.label} / ${item.label}`}
          </span>
        );
      }
    }
  }

  return <span className="text-sm font-medium text-foreground">ads-agent</span>;
}
```

- [ ] **Step 2: Replace `ads-agent/app/(admin)/layout.tsx`**

```tsx
import type { ReactNode } from "react";
import { Clock } from "lucide-react";
import { getCronSettings } from "@/lib/db/settings";
import { cn } from "@/lib/utils";
import { requireSession } from "@/lib/auth/dal";
import { Breadcrumb } from "@/components/Breadcrumb";
import { CommandPalette } from "@/components/CommandPalette";
import { RunNowButton } from "@/components/RunNowButton";
import { SidebarNav } from "@/components/SidebarNav";
import { UserMenu } from "@/components/UserMenu";
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
            <UserMenu email={session.email} role={session.role} />
          </div>
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
      <CommandPalette role={session.role} />
    </div>
  );
}
```

- [ ] **Step 3: Verify manually**

Run: `npm run build`
Expected: build succeeds with no type errors — this is the step that resolves Task 8's expected
type error from its own Step 2 (the `SidebarNav` call site now passes `role`).

Run: `npm run dev`, sign in, and confirm:
- The top-bar breadcrumb shows "Overview" on `/`, "Workspace / Campaigns" on `/campaigns`, etc., and
  "Admin / Settings" on `/settings` — matching each page's nav entry.
- Pressing `⌘K` (or `Ctrl+K`) opens the command palette from any page; typing filters the list; Escape
  and clicking the backdrop both close it; selecting a page navigates there.
- The avatar in the top-right opens a menu showing your email and role badge, with a "Sign out" item.
- As a `viewer`-role account (or by temporarily editing a test user's role in the DB), confirm the
  sidebar shows only "Workspace / Overview", the command palette's "Go to" group offers only
  "Overview", and navigating directly to `/users` still shows `ForbiddenNotice` (unchanged existing
  behavior — this plan never touches that guard).

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/layout.tsx" components/Breadcrumb.tsx
git commit -m "feat(ads-agent): wire breadcrumb, command palette, and user menu into admin layout"
```

---

### Task 10: Overview — flat KPI row

**Files:**
- Modify: `ads-agent/app/(admin)/page.tsx`

**Interfaces:**
- Consumes: unchanged (`getOverviewStats`, `getSpendCplTrend` from `@/lib/db/dashboard`; `listProposals`
  from `@/lib/db/proposals`; `STRATEGY` from `@/lib/decision-engine/strategy-config`).
- Produces: nothing new for later tasks — this is a leaf page.

**Skills:** senior-frontend, ui-design-system (density change — 4 Cards → 1 flat stat row).

No independent logic to TDD — presentational restyle only. Verify manually.

- [ ] **Step 1: Replace the KPI section of `ads-agent/app/(admin)/page.tsx`**

Replace the entire file with:

```tsx
import Link from "next/link";
import { AlertCircle, Clock3, Megaphone, TrendingUp } from "lucide-react";
import { getOverviewStats, getSpendCplTrend } from "@/lib/db/dashboard";
import { listProposals } from "@/lib/db/proposals";
import { STRATEGY } from "@/lib/decision-engine/strategy-config";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SpendCplChart } from "@/components/SpendCplChart";

function formatInr(value: number | null): string {
  if (value === null) return "—";
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default async function OverviewPage() {
  const [stats, trend, recentProposals] = await Promise.all([
    getOverviewStats(),
    getSpendCplTrend(30),
    listProposals("pending"),
  ]);

  const cplOverBreakeven = stats.blendedCplInr !== null && stats.blendedCplInr > STRATEGY.breakevenCplInr;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-lg border border-border sm:grid-cols-4 sm:divide-y-0">
        <div className="flex flex-col gap-1 px-5 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            Active campaigns
            <Megaphone className="size-4" />
          </div>
          <span className="text-2xl font-semibold text-foreground">{stats.activeCampaignCount}</span>
        </div>
        <div className="flex flex-col gap-1 px-5 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            Pending proposals
            <Clock3 className="size-4" />
          </div>
          <span className="text-2xl font-semibold text-foreground">{stats.pendingProposalCount}</span>
        </div>
        <div className="flex flex-col gap-1 px-5 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            This month&apos;s spend
            <TrendingUp className="size-4" />
          </div>
          <span className="text-2xl font-semibold text-foreground">{formatInr(stats.monthSpendInr)}</span>
        </div>
        <div className="flex flex-col gap-1 px-5 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            Blended CPL
            <AlertCircle className={cplOverBreakeven ? "size-4 text-destructive" : "size-4"} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-foreground">{formatInr(stats.blendedCplInr)}</span>
            <span className="text-sm text-muted-foreground">vs {formatInr(STRATEGY.breakevenCplInr)}</span>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Spend &amp; CPL, last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          {trend.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No performance data yet. Once campaigns run, this fills in.
            </p>
          ) : (
            <SpendCplChart data={trend} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Recent proposals</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {recentProposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending proposals right now.</p>
          ) : (
            recentProposals.slice(0, 5).map((proposal) => (
              <Link
                key={proposal.id}
                href={`/proposals/${proposal.id}`}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
              >
                <span className="flex items-center gap-2">
                  <Badge variant="outline">{proposal.kind}</Badge>
                  {proposal.triggeredRule}
                </span>
                <span className="text-muted-foreground">
                  {new Date(proposal.createdAt).toLocaleDateString()}
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`, open `http://localhost:3030/`.
Expected: the top-bar breadcrumb (from Task 9) reads "Overview" — the page body no longer needs its own
title (it never had one, so nothing to remove here, only the 4 Cards → 1 flat row change). The 4 stats
render side by side with hairline dividers and no individual card borders; the chart and recent-proposals
sections keep their existing Card treatment (they're separate content blocks, not KPIs).

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/page.tsx"
git commit -m "feat(ads-agent): flatten Overview KPIs into one stat row"
```

---

### Task 11: Campaigns — drop outer Card

**Files:**
- Modify: `ads-agent/app/(admin)/campaigns/page.tsx`

**Interfaces:**
- Consumes: unchanged (`requireRole`, `listCampaignsWithLatestCpl`, `CampaignWithCplRow`).
- Produces: nothing new for later tasks — leaf page.

**Skills:** senior-frontend, ui-design-system.

No independent logic to TDD. Verify manually.

- [ ] **Step 1: Replace `ads-agent/app/(admin)/campaigns/page.tsx`**

```tsx
import Link from "next/link";
import { Plus } from "lucide-react";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole } from "@/lib/auth/dal";
import { listCampaignsWithLatestCpl } from "@/lib/db/dashboard";
import type { CampaignWithCplRow } from "@/lib/db/dashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function formatInr(value: number | null): string {
  if (value === null) return "—";
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const STATUS_VARIANT: Record<CampaignWithCplRow["status"], "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  proposed: "secondary",
  paused: "outline",
  removed: "destructive",
};

export default async function CampaignsPage() {
  const access = await requireRole("operator");
  if (!access.ok) return <ForbiddenNotice />;

  const campaigns = await listCampaignsWithLatestCpl();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end border-b border-border pb-4">
        <Button asChild size="sm">
          <Link href="/campaigns/new">
            <Plus />
            New Campaign
          </Link>
        </Button>
      </div>
      {campaigns.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No campaigns yet. Proposals will appear here once the decision engine creates one.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Daily budget</TableHead>
              <TableHead>Corridor</TableHead>
              <TableHead>Latest CPL</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((campaign) => (
              <TableRow key={campaign.id}>
                <TableCell className="font-medium text-foreground">{campaign.name}</TableCell>
                <TableCell className="capitalize">{campaign.platform}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[campaign.status]}>{campaign.status}</Badge>
                </TableCell>
                <TableCell>{formatInr(campaign.dailyBudget)}</TableCell>
                <TableCell className="capitalize">{campaign.corridor ?? "—"}</TableCell>
                <TableCell>{formatInr(campaign.latestCplInr)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify manually**

Run: `npm test` (confirm nothing under `app/api/**` broke — this task never touches an API route).
Expected: PASS.

Run: `npm run dev`, open `http://localhost:3030/campaigns` as an `operator`+ account.
Expected: breadcrumb reads "Workspace / Campaigns"; page body has no repeated title, just the "New
Campaign" button and the table, no outer card border/shadow around the whole page.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/campaigns/page.tsx"
git commit -m "feat(ads-agent): flatten Campaigns page (drop outer Card)"
```

---

### Task 12: Proposals list — drop outer Card

**Files:**
- Modify: `ads-agent/app/(admin)/proposals/page.tsx`

**Interfaces:**
- Consumes: unchanged (`requireRole`, `listProposals`, `ProposalStatus`).
- Produces: nothing new for later tasks — leaf page. (`proposals/[id]/page.tsx` is explicitly
  **unchanged** by this plan — see Global Constraints' breadcrumb scope-trim note; its own `Card` +
  `CardTitle` already show the specific proposal's `kind`, which is a distinct concern from this list
  page's now-removed title.)

**Skills:** senior-frontend, ui-design-system.

No independent logic to TDD. Verify manually.

- [ ] **Step 1: Replace `ads-agent/app/(admin)/proposals/page.tsx`**

```tsx
import Link from "next/link";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole } from "@/lib/auth/dal";
import type { ProposalStatus } from "@/lib/types";
import { listProposals } from "@/lib/db/proposals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS_TABS: { value: ProposalStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "executed", label: "Executed" },
  { value: "failed", label: "Failed" },
];

function isProposalStatus(value: string): value is ProposalStatus {
  return STATUS_TABS.some((tab) => tab.value === value);
}

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const access = await requireRole("operator");
  if (!access.ok) return <ForbiddenNotice />;

  const { status: rawStatus } = await searchParams;
  const status: ProposalStatus = rawStatus && isProposalStatus(rawStatus) ? rawStatus : "pending";
  const proposals = await listProposals(status);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1 border-b border-border pb-4">
        {STATUS_TABS.map((tab) => (
          <Button key={tab.value} asChild size="sm" variant={tab.value === status ? "default" : "ghost"}>
            <Link href={`/proposals?status=${tab.value}`}>{tab.label}</Link>
          </Button>
        ))}
      </div>
      {proposals.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No {status} proposals.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead>Triggered rule</TableHead>
              <TableHead>Rationale</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proposals.map((proposal) => (
              <TableRow key={proposal.id}>
                <TableCell>
                  <Link href={`/proposals/${proposal.id}`} className="inline-block">
                    <Badge variant="outline">{proposal.kind}</Badge>
                  </Link>
                </TableCell>
                <TableCell>{proposal.triggeredRule}</TableCell>
                <TableCell className="max-w-md truncate text-muted-foreground">
                  {proposal.rationale ?? "(none)"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(proposal.createdAt).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify manually**

Run: `npm test` (confirm `app/api/proposals/[id]/approve/route.test.ts` and `.../reject/route.test.ts`
still pass unmodified).
Expected: PASS.

Run: `npm run dev`, open `http://localhost:3030/proposals`.
Expected: breadcrumb reads "Workspace / Proposals"; status tabs and table render with no outer card;
clicking into a proposal still shows its existing (unchanged) detail card.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/proposals/page.tsx"
git commit -m "feat(ads-agent): flatten Proposals list page (drop outer Card)"
```

---

### Task 13: Users — drop outer Cards

**Files:**
- Modify: `ads-agent/app/(admin)/users/page.tsx`

**Interfaces:**
- Consumes: unchanged (`requireRole`, `listOrgMembers`).
- Produces: nothing new for later tasks — leaf page.

**Skills:** senior-frontend, ui-design-system.

No independent logic to TDD. Verify manually.

- [ ] **Step 1: Replace `ads-agent/app/(admin)/users/page.tsx`**

```tsx
import { requireRole } from "@/lib/auth/dal";
import { listOrgMembers } from "@/lib/auth/internal-client";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssignRoleForm } from "./AssignRoleForm";

export default async function UsersPage() {
  const access = await requireRole("admin");
  if (!access.ok) return <ForbiddenNotice />;

  const { members, pending } = await listOrgMembers();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Members</h2>
        {members.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium text-foreground">{m.name ?? m.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{m.role}</Badge>
                  </TableCell>
                  <TableCell>
                    {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell>
                    <AssignRoleForm userId={m.userId} currentRole={m.role} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-sm font-semibold text-foreground">Pending approval ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No pending sign-ins.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((p) => (
                <TableRow key={p.userId}>
                  <TableCell className="font-medium text-foreground">{p.name ?? p.email}</TableCell>
                  <TableCell>
                    <AssignRoleForm userId={p.userId} currentRole={null} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`, open `http://localhost:3030/users` as an `admin` account.
Expected: breadcrumb reads "Admin / Users"; "Members" and "Pending approval (N)" render as two plain
sections separated by a hairline top border, no card chrome; role-assignment form still works.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/users/page.tsx"
git commit -m "feat(ads-agent): flatten Users page (drop outer Cards)"
```

---

### Task 14: Credits — drop Cards around listing tables only

**Files:**
- Modify: `ads-agent/app/(admin)/credits/page.tsx`

**Interfaces:**
- Consumes: unchanged (`requireRole`, `getSpendByFeature`, `getSpendByModel`, `getSpendTrend`,
  `listMemberBalances`, `listOrgBalances`, `AllocateCreditsForm`, `UsagePoller`).
- Produces: nothing new for later tasks — leaf page.

**Skills:** senior-frontend, ui-design-system.

No independent logic to TDD. Verify manually.

- [ ] **Step 1: Replace `ads-agent/app/(admin)/credits/page.tsx`**

```tsx
import {
  getSpendByFeature,
  getSpendByModel,
  getSpendTrend,
  listMemberBalances,
  listOrgBalances,
} from "@/lib/db/credits";
import { requireRole } from "@/lib/auth/dal";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AllocateCreditsForm } from "./AllocateCreditsForm";
import { UsagePoller } from "./UsagePoller";

function formatCredits(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default async function CreditsPage() {
  const access = await requireRole("admin");
  if (!access.ok) return <ForbiddenNotice />;
  const orgId = access.session.orgId!;

  const [orgBalances, members, spendByFeature, spendByModel, trend] = await Promise.all([
    listOrgBalances(),
    listMemberBalances(orgId),
    getSpendByFeature(orgId, 30),
    getSpendByModel(orgId, 30),
    getSpendTrend(orgId, 30),
  ]);

  const org = orgBalances.find((o) => o.orgId === orgId);

  return (
    <div className="flex flex-col gap-6">
      <UsagePoller />

      {orgBalances.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No organizations yet.</p>
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold text-foreground">
                {org?.orgName ?? "Organization"}
              </CardTitle>
              <p className="text-2xl font-semibold text-foreground">
                {formatCredits(org?.balanceCredits ?? 0)} credits
              </p>
            </div>
            <AllocateCreditsForm orgId={orgId} />
          </CardHeader>
        </Card>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-sm font-semibold text-foreground">Members</h2>
        {members.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Individual cap</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium text-foreground">{m.displayName ?? m.email}</TableCell>
                  <TableCell>
                    {m.capCredits === null ? (
                      <Badge variant="outline">No cap — draws from org pool</Badge>
                    ) : (
                      formatCredits(m.capCredits)
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 border-t border-border pt-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">Spend by feature (30d)</h2>
          {spendByFeature.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No usage yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Feature</TableHead>
                  <TableHead>Credits</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spendByFeature.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.key}</TableCell>
                    <TableCell>{formatCredits(row.totalCredits)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">Spend by model (30d)</h2>
          {spendByModel.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No usage yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Credits</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spendByModel.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.key}</TableCell>
                    <TableCell>{formatCredits(row.totalCredits)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-sm font-semibold text-foreground">Daily spend, last 30 days</h2>
        {trend.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No usage data yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Credits</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trend.map((point) => (
                <TableRow key={point.date}>
                  <TableCell>{point.date}</TableCell>
                  <TableCell>{formatCredits(point.totalCredits)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`, open `http://localhost:3030/credits` as an `admin` account.
Expected: breadcrumb reads "Admin / Usage & Credits"; the org-balance-and-allocate panel keeps its
`Card` (it's a config/action panel, not a listing); the four listing sections below it (Members, Spend
by feature, Spend by model, Daily spend) render as plain sections separated by hairline top borders, no
card chrome.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/credits/page.tsx"
git commit -m "feat(ads-agent): flatten Credits listing sections (keep allocate-panel Card)"
```

---

### Task 15: Full manual verification pass

**Files:** none — verification only.

**Interfaces:** consumes the finished state of every prior task; produces nothing.

**Skills:** senior-frontend (final sanity pass against the spec's own Success Criteria).

- [ ] **Step 1: Automated checks**

Run in `ads-agent/`: `npm run build && npm run lint && npm test`
Expected: all three pass with zero new warnings.

Run in `auth-service/`: `npm test`
Expected: passes (Task 6's new test file plus every pre-existing test).

- [ ] **Step 2: Role-based sidebar/palette check**

For each of `viewer`, `operator`, `admin` (assign via the Users page or directly in the `org_members`
table for a test account), sign in and confirm:
- Sidebar shows exactly the groups/items specified in Global Constraints for that role — nothing more.
- The command palette's "Go to" group offers exactly the same set.
- Directly navigating to a URL above the account's role (e.g. a `viewer` hitting `/users`) still shows
  `ForbiddenNotice` — unchanged existing behavior.

- [ ] **Step 3: Sign-out end-to-end check**

Sign in, click the avatar → Sign out. Confirm: browser lands on `auth-service`'s `/login`; a subsequent
visit to `http://localhost:3040/bridge` shows the Google sign-in screen again (does not silently
re-authenticate) — proving both the refresh token and the Auth.js session were actually ended, not just
the local `gs_session` cookie.

- [ ] **Step 4: Visual/density check, both themes**

Click through all six sidebar pages. Confirm: breadcrumb text matches the current page on every one; no
page body repeats its own title; Overview's KPIs render as one flat row; Campaigns/Proposals/Users/
Credits' listing tables have no outer card border; Settings is visually unchanged from before this plan.
Toggle OS-level dark mode and repeat the click-through — confirm every change above holds in dark mode
too, with readable contrast on every table, badge, and button.

- [ ] **Step 5: Report**

No commit for this task (verification only). If every check above passes, this plan is complete —
proceed to `superpowers:finishing-a-development-branch`. If anything fails, note exactly which step and
what was observed, and fix it as a small follow-up task before finishing the branch.
