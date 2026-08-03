# ads-agent Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: This plan is organized into **waves** for parallel execution (up to 8 subagents at once), a deliberate deviation from `superpowers:subagent-driven-development`'s default "never dispatch implementers in parallel" rule — safe here because every task within a wave owns a disjoint set of files. Use `superpowers:dispatching-parallel-agents` to dispatch all tasks in a wave together (multiple Task tool calls in the same message = parallel). Each implementer subagent follows `superpowers:test-driven-development` for any task with a Vitest cycle; UI-only tasks are scaffolding/presentation and are verified manually per their own steps instead (same convention as Task 1 of the original `ads-agent` plan). Run the task-reviewer gate (spec compliance + code quality) on every task as it completes; do **not** dispatch the next wave until every task in the current wave has passed review — later waves import files earlier waves create. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `ads-agent` a real, styled admin dashboard — a persistent sidebar with Overview, Campaigns, Proposals, and Settings pages — replacing the current unstyled `<table>`/`<p>` markup, per
[`docs/superpowers/specs/2026-08-03-ads-agent-admin-dashboard-design.md`](../specs/2026-08-03-ads-agent-admin-dashboard-design.md).

**Architecture:** Tailwind v4 + hand-authored shadcn/ui-style primitives (`components/ui/*`) installed into the existing `ads-agent/` Next.js app. A new `(admin)/layout.tsx` wraps all four pages with a sidebar + top bar. Two new read-only query modules (`lib/db/dashboard.ts`, `lib/env-status.ts`) feed the new Overview/Campaigns pages and the Settings connector-status panel; Proposals and Settings keep their existing API routes and data flow, restyled only.

**Tech Stack:** Next.js 15.5.21, React 19, TypeScript, Tailwind v4, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `recharts`, `@radix-ui/react-slot`, `@radix-ui/react-switch`, Vitest.

## Global Constraints

- **No new write path to a live ad account.** The Campaigns page is read-only; pausing or rebudgeting a campaign still only happens by approving a proposal. (Spec Non-goals.)
- **No authentication on the admin UI** — local-only, single user, unchanged from the original design. (Spec Non-goals.)
- **One accent color, reused from the main GentleSpace_Web app's real brand palette**, not a new invented color: light `--primary: #6840b8` / dark `--primary: #8b6fd1` (copied from `app/globals.css` in the repo root). Applied identically everywhere — no section gets a different accent. (Design-taste-frontend Color Consistency Lock, spec's design-system note.)
- **One corner-radius scale**: a single `--radius: 0.625rem` token, consumed by `--radius-sm/md/lg/xl` in the Tailwind `@theme` block. No ad-hoc arbitrary radius values anywhere else. (Shape Consistency Lock.)
- **Dark mode via `prefers-color-scheme` only** — no manual light/dark toggle switch (not required by the spec; a toggle would be unused scope for a single local user).
- **`lucide-react`** is the icon library, matching shadcn/ui's own generated code — not held to `design-taste-frontend`'s landing-page icon discouragement, because that skill's own Section 13 excludes dashboards/admin panels from its scope.
- **Empty states are explicit and worded**, not a blank table: "No campaigns yet…", "No {status} proposals.", "No performance data yet…". (Spec's "UI states" section.)
- **Page components stay thin server components.** Only `lib/db/dashboard.ts` and `lib/env-status.ts` carry unit-tested logic; no new component-testing framework is introduced. (Spec Testing section.)
- **Follow this repo's existing `ads-agent` conventions exactly**: colocated `*.test.ts` files, `vi.mock("./client", ...)` pool-mocking (see `lib/db/campaigns.test.ts`), `getPool()` + snake_case-row → camelCase-object mapper pattern (see `lib/db/campaigns.ts`), `@/*` → `./*` path alias.
- **This repo's Next.js has breaking changes vs. training-data conventions (per `AGENTS.md`).** Dynamic route `params` **and** `searchParams` are `Promise`-typed in Next 15.5.21 (`{ searchParams: Promise<{ status?: string }> }`, must `await searchParams`) — Task 7 introduces the first `searchParams` usage in this codebase; verify this is still current in `node_modules/next/dist/docs/` before writing that task's code if anything looks off.
- **Do not add dependencies with hand-picked version numbers.** Every new package is installed via `npm install <name>` (or `-D`) so npm resolves and pins the actual latest version in `package.json`/`package-lock.json` — never hand-type a guessed semver range.

---

## Parallel Execution Plan

```text
Wave 0 (3 parallel)  Task 1 — Tailwind v4 + shadcn-style UI primitives foundation
                     Task 2 — lib/db/dashboard.ts (KPI + trend + campaigns-with-CPL queries)
                     Task 3 — lib/env-status.ts (connector-configured booleans)
                        ↓ (all 3 must pass review first)
Wave 1 (solo)        Task 4 — (admin) layout: sidebar + top bar + RunNowButton
                        ↓ (must pass review first)
Wave 2 (4 parallel)  Task 5 — Overview page + spend/CPL chart
                     Task 6 — Campaigns page (read-only table)
                     Task 7 — Proposals restyle (list + detail + actions)
                     Task 8 — Settings restyle + connector status panel
```

Each task's **Interfaces** block states exactly what it consumes from an earlier wave and produces for a later one; siblings within a wave touch disjoint files and never need each other's output.

---

### Task 1: Tailwind v4 + shadcn-style UI primitives foundation

**Files:**
- Modify: `ads-agent/package.json` (via `npm install`, not hand-edited)
- Create: `ads-agent/postcss.config.mjs`
- Create: `ads-agent/components.json`
- Create: `ads-agent/lib/utils.ts`
- Modify: `ads-agent/app/globals.css`
- Modify: `ads-agent/app/layout.tsx`
- Create: `ads-agent/components/ui/button.tsx`
- Create: `ads-agent/components/ui/badge.tsx`
- Create: `ads-agent/components/ui/card.tsx`
- Create: `ads-agent/components/ui/table.tsx`
- Create: `ads-agent/components/ui/switch.tsx`
- Create: `ads-agent/components/ui/alert.tsx`

**Interfaces:**
- Consumes: nothing (first task; existing `ads-agent/app/layout.tsx` and `globals.css` are being replaced, not extended).
- Produces: `cn()` from `@/lib/utils`; `Button`/`buttonVariants` from `@/components/ui/button` (supports `asChild` via `@radix-ui/react-slot`); `Badge`/`badgeVariants` from `@/components/ui/badge`; `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter` from `@/components/ui/card`; `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` from `@/components/ui/table`; `Switch` from `@/components/ui/switch`; `Alert`/`AlertTitle`/`AlertDescription` from `@/components/ui/alert`. Tailwind utility classes `bg-background`, `text-foreground`, `bg-primary`, `text-primary-foreground`, `bg-card`, `bg-secondary`, `bg-muted`, `text-muted-foreground`, `bg-accent`, `text-accent-foreground`, `bg-destructive`, `text-destructive-foreground`, `border-border`, `ring-ring`, and `rounded-sm/md/lg/xl` all become available globally once `app/globals.css` is loaded.

This is scaffolding with no independent logic to TDD — verify manually per the steps below, same convention as Task 1 of the original `ads-agent` plan.

- [ ] **Step 1: Install the new dependencies**

Run inside `ads-agent/`:

```bash
npm install class-variance-authority clsx tailwind-merge lucide-react recharts @radix-ui/react-slot @radix-ui/react-switch
npm install -D tailwindcss @tailwindcss/postcss
```

Expected: `package.json` now has these seven entries (five in `dependencies`, two in `devDependencies`) with whatever versions npm resolved — do not hand-edit version numbers.

- [ ] **Step 2: Create `ads-agent/postcss.config.mjs`**

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 3: Create `ads-agent/components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "zinc",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui"
  }
}
```

- [ ] **Step 4: Create `ads-agent/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: Replace `ads-agent/app/globals.css`**

```css
@import "tailwindcss";

:root {
  color-scheme: light dark;
  --radius: 0.625rem;
  --background: #ffffff;
  --foreground: #1a1524;
  --card: #ffffff;
  --card-foreground: #1a1524;
  --primary: #6840b8;
  --primary-foreground: #ffffff;
  --secondary: #f6f5f8;
  --secondary-foreground: #1a1524;
  --muted: #f6f5f8;
  --muted-foreground: #6e667c;
  --accent: #f0ebf8;
  --accent-foreground: #1a1524;
  --destructive: #dc2626;
  --destructive-foreground: #ffffff;
  --border: #e2dde9;
  --input: #e2dde9;
  --ring: #6840b8;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #141218;
    --foreground: #f2eff7;
    --card: #1c1824;
    --card-foreground: #f2eff7;
    --primary: #8b6fd1;
    --primary-foreground: #141218;
    --secondary: #1c1824;
    --secondary-foreground: #f2eff7;
    --muted: #1c1824;
    --muted-foreground: #9b93ad;
    --accent: #2a2438;
    --accent-foreground: #f2eff7;
    --destructive: #f87171;
    --destructive-foreground: #141218;
    --border: #342e42;
    --input: #342e42;
    --ring: #8b6fd1;
  }
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
}

@layer base {
  * {
    border-color: var(--color-border);
  }
  body {
    background-color: var(--color-background);
    color: var(--color-foreground);
  }
}
```

- [ ] **Step 6: Replace `ads-agent/app/layout.tsx`**

```tsx
import "./globals.css";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata = { title: "Ads Agent" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
```

The old top-level `<nav>` is removed here — the new `(admin)/layout.tsx` (Task 4) provides sidebar navigation for the admin pages instead.

- [ ] **Step 7: Create `ads-agent/components/ui/button.tsx`**

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
        outline: "border border-border bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-6",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
```

- [ ] **Step 8: Create `ads-agent/components/ui/badge.tsx`**

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
```

- [ ] **Step 9: Create `ads-agent/components/ui/card.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-card text-card-foreground shadow-sm", className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-medium text-muted-foreground", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center p-6 pt-0", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
```

- [ ] **Step 10: Create `ads-agent/components/ui/table.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("border-b border-border", className)} {...props} />;
}

function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("border-b border-border transition-colors hover:bg-muted/50", className)} {...props} />
  );
}

function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "h-10 px-3 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("p-3 align-middle", className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
```

- [ ] **Step 11: Create `ads-agent/components/ui/switch.tsx`**

```tsx
"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
```

- [ ] **Step 12: Create `ads-agent/components/ui/alert.tsx`**

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-lg border border-border p-4 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:size-4 [&>svg+*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive: "border-destructive/40 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h5 className={cn("mb-1 font-medium leading-none", className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm [&_p]:leading-relaxed", className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription };
```

- [ ] **Step 13: Verify the app still builds and runs**

Run: `npm run build`
Expected: build succeeds with no type errors (the `(admin)/proposals` and `(admin)/settings` pages still compile against the old plain-HTML markup — they are restyled in Wave 2, not touched here).

Run: `npm run dev` then open `http://localhost:3030/proposals`
Expected: page renders (unstyled markup is fine at this point — Tailwind is installed but not yet applied to that page); no console errors about missing CSS variables or failed module resolution.

- [ ] **Step 14: Commit**

```bash
git add package.json package-lock.json postcss.config.mjs components.json lib/utils.ts app/globals.css app/layout.tsx components/ui
git commit -m "feat(ads-agent): install Tailwind v4 and shadcn-style UI primitives"
```

---

### Task 2: `lib/db/dashboard.ts` — Overview KPIs, spend/CPL trend, campaigns-with-CPL

**Files:**
- Create: `ads-agent/lib/db/dashboard.ts`
- Create: `ads-agent/lib/db/dashboard.test.ts`

**Interfaces:**
- Consumes: `getPool()` from `./client` (existing); `Platform`, `CampaignStatus` from `../types` (existing).
- Produces: `getOverviewStats(): Promise<OverviewStats>`, `getSpendCplTrend(days: number): Promise<TrendPoint[]>`, `listCampaignsWithLatestCpl(): Promise<CampaignWithCplRow[]>`, and their exported types `OverviewStats`, `TrendPoint`, `CampaignWithCplRow` — all consumed by Task 5 (Overview) and Task 6 (Campaigns).

- [ ] **Step 1: Write the failing tests**

Create `ads-agent/lib/db/dashboard.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import { getOverviewStats, getSpendCplTrend, listCampaignsWithLatestCpl } from "./dashboard";

beforeEach(() => query.mockReset());

describe("getOverviewStats", () => {
  it("computes blended CPL from total spend and conversions", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: "3" }] })
      .mockResolvedValueOnce({ rows: [{ count: "5" }] })
      .mockResolvedValueOnce({ rows: [{ spend: "10000", conversions: "4" }] });

    const result = await getOverviewStats();

    expect(result).toEqual({
      activeCampaignCount: 3,
      pendingProposalCount: 5,
      monthSpendInr: 10000,
      blendedCplInr: 2500,
    });
  });

  it("returns a null blended CPL when there are zero conversions this month", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: "0" }] })
      .mockResolvedValueOnce({ rows: [{ count: "0" }] })
      .mockResolvedValueOnce({ rows: [{ spend: "0", conversions: "0" }] });

    const result = await getOverviewStats();

    expect(result.blendedCplInr).toBeNull();
    expect(result.monthSpendInr).toBe(0);
  });
});

describe("getSpendCplTrend", () => {
  it("maps each day's totals and computes per-day CPL", async () => {
    query.mockResolvedValue({
      rows: [
        { day: new Date("2026-08-01T00:00:00.000Z"), spend: "5000", conversions: "2" },
        { day: new Date("2026-08-02T00:00:00.000Z"), spend: "3000", conversions: "0" },
      ],
    });

    const result = await getSpendCplTrend(30);

    expect(result).toEqual([
      { date: "2026-08-01", spendInr: 5000, cplInr: 2500 },
      { date: "2026-08-02", spendInr: 3000, cplInr: null },
    ]);
  });

  it("returns an empty array when there are no snapshots", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getSpendCplTrend(30)).resolves.toEqual([]);
  });
});

describe("listCampaignsWithLatestCpl", () => {
  it("maps each campaign with its most recent CPL", async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: "camp-1",
          name: "Whitefield Office Search",
          platform: "google",
          status: "active",
          daily_budget: "500",
          corridor: "whitefield",
          latest_cpl: "1800",
        },
      ],
    });

    const result = await listCampaignsWithLatestCpl();

    expect(result).toEqual([
      {
        id: "camp-1",
        name: "Whitefield Office Search",
        platform: "google",
        status: "active",
        dailyBudget: 500,
        corridor: "whitefield",
        latestCplInr: 1800,
      },
    ]);
  });

  it("returns null latestCplInr for a campaign with no snapshots yet", async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: "camp-2",
          name: "New Campaign",
          platform: "meta",
          status: "proposed",
          daily_budget: null,
          corridor: null,
          latest_cpl: null,
        },
      ],
    });

    const result = await listCampaignsWithLatestCpl();
    expect(result[0].latestCplInr).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- dashboard`
Expected: FAIL with "Failed to resolve import ./dashboard" or similar module-not-found error.

- [ ] **Step 3: Write the implementation**

Create `ads-agent/lib/db/dashboard.ts`:

```ts
import type { CampaignStatus, Platform } from "../types";
import { getPool } from "./client";

export type OverviewStats = {
  activeCampaignCount: number;
  pendingProposalCount: number;
  monthSpendInr: number;
  blendedCplInr: number | null;
};

export async function getOverviewStats(): Promise<OverviewStats> {
  const [activeResult, pendingResult, spendResult] = await Promise.all([
    getPool().query<{ count: string }>(`SELECT COUNT(*) AS count FROM campaigns WHERE status = 'active'`),
    getPool().query<{ count: string }>(`SELECT COUNT(*) AS count FROM proposals WHERE status = 'pending'`),
    getPool().query<{ spend: string; conversions: string }>(
      `SELECT COALESCE(SUM(spend), 0) AS spend, COALESCE(SUM(conversions), 0) AS conversions
       FROM performance_snapshots
       WHERE captured_at >= date_trunc('month', now())`,
    ),
  ]);

  const monthSpendInr = Number(spendResult.rows[0].spend);
  const monthConversions = Number(spendResult.rows[0].conversions);

  return {
    activeCampaignCount: Number(activeResult.rows[0].count),
    pendingProposalCount: Number(pendingResult.rows[0].count),
    monthSpendInr,
    blendedCplInr: monthConversions > 0 ? monthSpendInr / monthConversions : null,
  };
}

export type TrendPoint = { date: string; spendInr: number; cplInr: number | null };

type TrendRow = { day: Date; spend: string; conversions: string };

export async function getSpendCplTrend(days: number): Promise<TrendPoint[]> {
  const { rows } = await getPool().query<TrendRow>(
    `SELECT date_trunc('day', captured_at) AS day,
            COALESCE(SUM(spend), 0) AS spend,
            COALESCE(SUM(conversions), 0) AS conversions
     FROM performance_snapshots
     WHERE captured_at >= NOW() - INTERVAL '${days} days'
     GROUP BY day
     ORDER BY day ASC`,
  );

  return rows.map((row) => {
    const spendInr = Number(row.spend);
    const conversions = Number(row.conversions);
    return {
      date: row.day.toISOString().slice(0, 10),
      spendInr,
      cplInr: conversions > 0 ? spendInr / conversions : null,
    };
  });
}

export type CampaignWithCplRow = {
  id: string;
  name: string;
  platform: Platform;
  status: CampaignStatus;
  dailyBudget: number | null;
  corridor: string | null;
  latestCplInr: number | null;
};

type CampaignWithCplSqlRow = {
  id: string;
  name: string;
  platform: Platform;
  status: CampaignStatus;
  daily_budget: string | null;
  corridor: string | null;
  latest_cpl: string | null;
};

export async function listCampaignsWithLatestCpl(): Promise<CampaignWithCplRow[]> {
  const { rows } = await getPool().query<CampaignWithCplSqlRow>(
    `SELECT c.id, c.name, c.platform, c.status, c.daily_budget, c.corridor, latest.cpl AS latest_cpl
     FROM campaigns c
     LEFT JOIN LATERAL (
       SELECT cpl FROM performance_snapshots
       WHERE campaign_id = c.id
       ORDER BY captured_at DESC
       LIMIT 1
     ) latest ON true
     ORDER BY c.created_at DESC`,
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    platform: row.platform,
    status: row.status,
    dailyBudget: row.daily_budget === null ? null : Number(row.daily_budget),
    corridor: row.corridor,
    latestCplInr: row.latest_cpl === null ? null : Number(row.latest_cpl),
  }));
}
```

Note: `days` is interpolated directly into the `INTERVAL` string rather than parameterized — this matches the existing precedent in `lib/db/snapshots.ts`'s `recentPerformanceSnapshots(days)`, and `days` is always an internal caller-controlled number, never raw user input.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- dashboard`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/db/dashboard.ts lib/db/dashboard.test.ts
git commit -m "feat(ads-agent): add dashboard KPI, trend, and campaign-CPL queries"
```

---

### Task 3: `lib/env-status.ts` — connector-configured booleans

**Files:**
- Create: `ads-agent/lib/env-status.ts`
- Create: `ads-agent/lib/env-status.test.ts`

**Interfaces:**
- Consumes: nothing (reads `process.env` directly).
- Produces: `getConnectorStatus(): ConnectorStatus` and the `ConnectorStatus` type (`{ meta: boolean; googleAds: boolean; twenty: boolean; openai: boolean }`), consumed by Task 8 (Settings connector-status panel).

- [ ] **Step 1: Write the failing tests**

Create `ads-agent/lib/env-status.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConnectorStatus } from "./env-status";

const ENV_KEYS = [
  "META_ACCESS_TOKEN",
  "META_AD_ACCOUNT_ID",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
  "TWENTY_API_KEY",
  "OPENAI_API_KEY",
] as const;

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("getConnectorStatus", () => {
  it("reports everything unconfigured when no env vars are set", () => {
    expect(getConnectorStatus()).toEqual({
      meta: false,
      googleAds: false,
      twenty: false,
      openai: false,
    });
  });

  it("reports meta configured only when both meta vars are set", () => {
    process.env.META_ACCESS_TOKEN = "token";
    expect(getConnectorStatus().meta).toBe(false);
    process.env.META_AD_ACCOUNT_ID = "12345";
    expect(getConnectorStatus().meta).toBe(true);
  });

  it("reports googleAds configured only when all five vars are set", () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
    process.env.GOOGLE_ADS_CLIENT_ID = "client-id";
    process.env.GOOGLE_ADS_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_ADS_REFRESH_TOKEN = "refresh-token";
    expect(getConnectorStatus().googleAds).toBe(false);
    process.env.GOOGLE_ADS_CUSTOMER_ID = "1234567890";
    expect(getConnectorStatus().googleAds).toBe(true);
  });

  it("reports twenty configured when TWENTY_API_KEY is set", () => {
    process.env.TWENTY_API_KEY = "key";
    expect(getConnectorStatus().twenty).toBe(true);
  });

  it("reports openai configured when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "key";
    expect(getConnectorStatus().openai).toBe(true);
  });

  it("treats a blank/whitespace-only value as unconfigured", () => {
    process.env.TWENTY_API_KEY = "   ";
    expect(getConnectorStatus().twenty).toBe(false);
  });

  it("never includes the actual secret values in its return object", () => {
    process.env.META_ACCESS_TOKEN = "super-secret-token";
    process.env.META_AD_ACCOUNT_ID = "12345";
    const result = getConnectorStatus();
    expect(JSON.stringify(result)).not.toContain("super-secret-token");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- env-status`
Expected: FAIL with "Failed to resolve import ./env-status" or similar module-not-found error.

- [ ] **Step 3: Write the implementation**

Create `ads-agent/lib/env-status.ts`:

```ts
export type ConnectorStatus = {
  meta: boolean;
  googleAds: boolean;
  twenty: boolean;
  openai: boolean;
};

function isSet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export function getConnectorStatus(): ConnectorStatus {
  return {
    meta: isSet("META_ACCESS_TOKEN") && isSet("META_AD_ACCOUNT_ID"),
    googleAds:
      isSet("GOOGLE_ADS_DEVELOPER_TOKEN") &&
      isSet("GOOGLE_ADS_CLIENT_ID") &&
      isSet("GOOGLE_ADS_CLIENT_SECRET") &&
      isSet("GOOGLE_ADS_REFRESH_TOKEN") &&
      isSet("GOOGLE_ADS_CUSTOMER_ID"),
    twenty: isSet("TWENTY_API_KEY"),
    openai: isSet("OPENAI_API_KEY"),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- env-status`
Expected: PASS, all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/env-status.ts lib/env-status.test.ts
git commit -m "feat(ads-agent): add connector-configured status checks"
```

---

### Task 4: `(admin)` layout — sidebar, top bar, RunNowButton

**Files:**
- Delete: `ads-agent/app/page.tsx`
- Create: `ads-agent/app/(admin)/layout.tsx`
- Create: `ads-agent/components/SidebarNav.tsx`
- Create: `ads-agent/components/RunNowButton.tsx`
- Modify: `ads-agent/README.md`

**Interfaces:**
- Consumes: `Button` from `@/components/ui/button` (Task 1); `cn` from `@/lib/utils` (Task 1); `getCronSettings()` from `@/lib/db/settings` (existing, unchanged).
- Produces: the `(admin)` route group now has a shared layout, so every page created under `app/(admin)/**` automatically renders inside the sidebar shell. `RunNowButton` from `@/components/RunNowButton` is consumed directly by Task 8 (Settings restyle).

This is scaffolding/presentation — no independent logic to TDD. Verify manually per the steps below.

- [ ] **Step 1: Delete `ads-agent/app/page.tsx`**

```bash
rm ads-agent/app/page.tsx
```

This file currently does `redirect("/proposals")`. Route `/` will 404 until Task 5 creates `app/(admin)/page.tsx` — expected and fine, Task 5 runs in the very next wave.

- [ ] **Step 2: Create `ads-agent/components/RunNowButton.tsx`**

```tsx
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
```

- [ ] **Step 3: Create `ads-agent/components/SidebarNav.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, LayoutDashboard, Megaphone, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/proposals", label: "Proposals", icon: ClipboardList },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-3">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="size-4" strokeWidth={2} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Create `ads-agent/app/(admin)/layout.tsx`**

```tsx
import type { ReactNode } from "react";
import { getCronSettings } from "@/lib/db/settings";
import { cn } from "@/lib/utils";
import { RunNowButton } from "@/components/RunNowButton";
import { SidebarNav } from "@/components/SidebarNav";

export default async function AdminLayout({ children }: { children: ReactNode }) {
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
```

- [ ] **Step 5: Update `ads-agent/README.md`**

Add this paragraph directly after the existing "Product/audience context…" paragraph (after the sentence ending "`ads` skill."):

```markdown

The admin UI (`/`, `/campaigns`, `/proposals`, `/settings`) is a Tailwind v4 +
shadcn-style dashboard behind a persistent sidebar; see
[`docs/superpowers/specs/2026-08-03-ads-agent-admin-dashboard-design.md`](../docs/superpowers/specs/2026-08-03-ads-agent-admin-dashboard-design.md)
for the design.
```

- [ ] **Step 6: Verify manually**

Run: `npm run dev`, open `http://localhost:3030/proposals` and `http://localhost:3030/settings`.
Expected: both pages now render inside the new sidebar + top bar shell (still with their old unstyled inner content — that's restyled in Wave 2). The sidebar highlights the active link. The top bar shows "Cron: off · Last run never" (or real values if a cycle already ran) and a working "Run now" button. Opening `http://localhost:3030/` shows a 404 — expected until Task 5.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx "app/(admin)/layout.tsx" components/RunNowButton.tsx components/SidebarNav.tsx README.md
git commit -m "feat(ads-agent): add admin sidebar layout and run-now control"
```

---

### Task 5: Overview page + spend/CPL trend chart

**Files:**
- Create: `ads-agent/app/(admin)/page.tsx`
- Create: `ads-agent/components/SpendCplChart.tsx`

**Interfaces:**
- Consumes: `getOverviewStats`, `getSpendCplTrend`, `TrendPoint` from `@/lib/db/dashboard` (Task 2); `listProposals` from `@/lib/db/proposals` (existing); `STRATEGY` from `@/lib/decision-engine/strategy-config` (existing); `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Badge` from Task 1.
- Produces: route `/` (Overview), the dashboard's landing page.

No independent logic to TDD — this is a thin server component rendering already-tested query results, plus a presentational chart wrapper with no branching logic. Verify manually.

- [ ] **Step 1: Create `ads-agent/components/SpendCplChart.tsx`**

```tsx
"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TrendPoint } from "@/lib/db/dashboard";

// A single chart doesn't need shadcn's generic ChartContainer abstraction —
// Recharts directly, styled inline via CSS vars, is the smaller diff.
export function SpendCplChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              fontSize: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey="spendInr"
            name="Spend (₹)"
            stroke="var(--color-primary)"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="cplInr"
            name="CPL (₹)"
            stroke="var(--color-destructive)"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Create `ads-agent/app/(admin)/page.tsx`**

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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle>Active campaigns</CardTitle>
            <Megaphone className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-foreground">
            {stats.activeCampaignCount}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle>Pending proposals</CardTitle>
            <Clock3 className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-foreground">
            {stats.pendingProposalCount}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle>This month&apos;s spend</CardTitle>
            <TrendingUp className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-foreground">
            {formatInr(stats.monthSpendInr)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle>Blended CPL</CardTitle>
            <AlertCircle
              className={cplOverBreakeven ? "size-4 text-destructive" : "size-4 text-muted-foreground"}
            />
          </CardHeader>
          <CardContent className="flex items-baseline gap-2 text-2xl font-semibold text-foreground">
            {formatInr(stats.blendedCplInr)}
            <span className="text-sm font-normal text-muted-foreground">
              vs {formatInr(STRATEGY.breakevenCplInr)} breakeven
            </span>
          </CardContent>
        </Card>
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

- [ ] **Step 3: Verify manually**

Run: `npm run dev`, open `http://localhost:3030/`.
Expected: four KPI cards (`0` counts and `—` spend/CPL are correct if the local DB is empty), a "No performance data yet…" message where the chart would be, and "No pending proposals right now." — matching the spec's zero-state requirement. No console/type errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/page.tsx" components/SpendCplChart.tsx
git commit -m "feat(ads-agent): add Overview dashboard page with spend/CPL trend chart"
```

---

### Task 6: Campaigns page (read-only)

**Files:**
- Create: `ads-agent/app/(admin)/campaigns/page.tsx`

**Interfaces:**
- Consumes: `listCampaignsWithLatestCpl`, `CampaignWithCplRow` from `@/lib/db/dashboard` (Task 2); `Badge`, `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` from Task 1.
- Produces: route `/campaigns`.

No independent logic to TDD — thin server component over an already-tested query. Verify manually.

- [ ] **Step 1: Create `ads-agent/app/(admin)/campaigns/page.tsx`**

```tsx
import { listCampaignsWithLatestCpl } from "@/lib/db/dashboard";
import type { CampaignWithCplRow } from "@/lib/db/dashboard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const campaigns = await listCampaignsWithLatestCpl();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-foreground">Campaigns</CardTitle>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`, open `http://localhost:3030/campaigns`.
Expected: "No campaigns yet…" message (empty local DB). No write controls anywhere on this page — confirm by inspection that there is no button, form, or link that mutates a campaign.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/campaigns/page.tsx"
git commit -m "feat(ads-agent): add read-only Campaigns page"
```

---

### Task 7: Proposals restyle (list + detail + actions)

**Files:**
- Modify: `ads-agent/app/(admin)/proposals/page.tsx`
- Modify: `ads-agent/app/(admin)/proposals/[id]/page.tsx`
- Modify: `ads-agent/app/(admin)/proposals/[id]/ProposalActions.tsx`

**Interfaces:**
- Consumes: `listProposals`, `getProposalById` from `@/lib/db/proposals` (existing, unchanged); `ProposalStatus` from `@/lib/types` (existing); `Alert`/`AlertTitle`/`AlertDescription`, `Badge`, `Button`, `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` from Task 1.
- Produces: restyled `/proposals` and `/proposals/[id]` routes; no new exports consumed elsewhere.

No independent logic to TDD — this restyles existing, already-covered-by-API-route-tests behavior. Verify manually.

- [ ] **Step 1: Replace `ads-agent/app/(admin)/proposals/page.tsx`**

```tsx
import Link from "next/link";
import type { ProposalStatus } from "@/lib/types";
import { listProposals } from "@/lib/db/proposals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const { status: rawStatus } = await searchParams;
  const status: ProposalStatus = rawStatus && isProposalStatus(rawStatus) ? rawStatus : "pending";
  const proposals = await listProposals(status);

  return (
    <Card>
      <CardHeader className="gap-3">
        <CardTitle className="text-base font-semibold text-foreground">Proposals</CardTitle>
        <div className="flex flex-wrap gap-1">
          {STATUS_TABS.map((tab) => (
            <Button key={tab.value} asChild size="sm" variant={tab.value === status ? "default" : "ghost"}>
              <Link href={`/proposals?status=${tab.value}`}>{tab.label}</Link>
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Replace `ads-agent/app/(admin)/proposals/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { getProposalById } from "@/lib/db/proposals";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProposalActions } from "./ProposalActions";

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const proposal = await getProposalById(id);
  if (!proposal) notFound();

  return (
    <Card className="max-w-2xl">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold text-foreground">{proposal.kind}</CardTitle>
        <Badge variant={proposal.status === "failed" ? "destructive" : "secondary"}>{proposal.status}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">Triggered rule</dt>
          <dd>{proposal.triggeredRule}</dd>
          <dt className="text-muted-foreground">Rationale</dt>
          <dd>{proposal.rationale ?? "(none)"}</dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd>{new Date(proposal.createdAt).toLocaleString()}</dd>
        </dl>

        <div>
          <p className="mb-1 text-sm font-medium text-muted-foreground">Payload</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(proposal.payload, null, 2)}
          </pre>
        </div>

        {proposal.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Execution failed</AlertTitle>
            <AlertDescription>{proposal.error}</AlertDescription>
          </Alert>
        )}

        {proposal.status === "pending" && <ProposalActions proposalId={proposal.id} />}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Replace `ads-agent/app/(admin)/proposals/[id]/ProposalActions.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ProposalActions({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function decide(action: "approve" | "reject") {
    setPending(true);
    try {
      await fetch(`/api/proposals/${proposalId}/${action}`, { method: "POST" });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex gap-2 pt-2">
      <Button disabled={pending} onClick={() => decide("approve")}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Approve
      </Button>
      <Button variant="destructive" disabled={pending} onClick={() => decide("reject")}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Reject
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Verify manually**

Run: `npm test` (confirm the existing `app/api/proposals/[id]/approve/route.test.ts` and `.../reject/route.test.ts` still pass unmodified — this task never touches those files or the underlying `lib/db/proposals.ts`).
Expected: PASS.

Run: `npm run dev`, open `http://localhost:3030/proposals`.
Expected: status-filter buttons for Pending/Approved/Rejected/Executed/Failed, each navigating via `?status=`, with the active one highlighted; "No {status} proposals." when a tab is empty; clicking a proposal shows the restyled detail card with Approve/Reject buttons that still call the existing API routes.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/proposals"
git commit -m "feat(ads-agent): restyle Proposals list and detail with status filters"
```

---

### Task 8: Settings restyle + connector status panel

**Files:**
- Modify: `ads-agent/app/(admin)/settings/page.tsx`
- Modify: `ads-agent/app/(admin)/settings/SettingsForm.tsx`

**Interfaces:**
- Consumes: `getCronSettings` from `@/lib/db/settings` (existing, unchanged); `getConnectorStatus` from `@/lib/env-status` (Task 3); `CronSettings` from `@/lib/types` (existing); `RunNowButton` from `@/components/RunNowButton` (Task 4); `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Switch` from Task 1.
- Produces: restyled `/settings` route; no new exports consumed elsewhere.

No independent logic to TDD — this restyles existing, already-covered-by-API-route-tests behavior plus renders Task 3's already-tested booleans. Verify manually.

- [ ] **Step 1: Replace `ads-agent/app/(admin)/settings/page.tsx`**

```tsx
import { getCronSettings } from "@/lib/db/settings";
import { getConnectorStatus } from "@/lib/env-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsForm } from "./SettingsForm";

const CONNECTOR_LABELS = {
  meta: "Meta Marketing API",
  googleAds: "Google Ads API",
  twenty: "Twenty CRM",
  openai: "OpenAI (rationale drafting)",
} as const;

export default async function SettingsPage() {
  const settings = await getCronSettings();
  const connectorStatus = getConnectorStatus();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Decision cycle</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm settings={settings} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Connector status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(Object.keys(CONNECTOR_LABELS) as Array<keyof typeof CONNECTOR_LABELS>).map((key) => (
            <div key={key} className="flex items-center justify-between text-sm">
              <span>{CONNECTOR_LABELS[key]}</span>
              <span className="flex items-center gap-2">
                <span
                  className={
                    connectorStatus[key] ? "size-2 rounded-full bg-emerald-500" : "size-2 rounded-full bg-destructive"
                  }
                  aria-hidden
                />
                {connectorStatus[key] ? "Configured" : "Not configured"}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Replace `ads-agent/app/(admin)/settings/SettingsForm.tsx`**

```tsx
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
```

- [ ] **Step 3: Verify manually**

Run: `npm test` (confirm the existing `app/api/settings/route.test.ts` and `app/api/cycle/run/route.test.ts` still pass unmodified).
Expected: PASS.

Run: `npm run dev`, open `http://localhost:3030/settings`.
Expected: a switch toggling cron on/off, a "Run cycle now" button (identical component to the one in the top bar), and a connector status panel listing Meta/Google Ads/Twenty CRM/OpenAI each as "Not configured" (red dot) if `.env.local` has no real credentials yet, or "Configured" (green dot) for whichever env vars are actually set. Confirm no secret value ever appears in the rendered HTML (View Source).

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/settings"
git commit -m "feat(ads-agent): restyle Settings with connector status panel"
```

---

## Final Manual Verification (human, after all waves pass review)

1. `npm run build && npm run lint && npm test` all pass with zero new warnings.
2. `npm run dev`, click through all four sidebar pages; confirm the sidebar highlights the active page and the top bar's cron status/last-run/run-now stay consistent across page navigations.
3. Toggle the cron switch on Settings, confirm the top bar's "Cron: on/off" updates after `router.refresh()`.
4. Approve or reject a pending proposal from the Proposals detail page (or via `npm run cycle:run` to generate one first, per the original `ads-agent` README), confirm the row disappears from the "Pending" tab and reappears under the corresponding tab.
5. Resize the browser to a narrow width and confirm nothing breaks catastrophically (no pixel-perfect mobile requirement per the design spec's non-goals, but the layout should not overlap or clip).
6. Toggle OS-level dark mode and confirm all four pages switch to the dark palette with readable contrast (WCAG AA) on every card, table, badge, and button.
