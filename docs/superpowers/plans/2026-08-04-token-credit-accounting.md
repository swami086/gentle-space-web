# Token Credit Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: This plan is organized into **waves** for parallel
> execution (up to 8 subagents at once), a deliberate deviation from
> `superpowers:subagent-driven-development`'s default "never dispatch implementers in parallel" rule
> — safe here because every task within a wave owns a disjoint set of files. Use
> `superpowers:dispatching-parallel-agents` to dispatch all tasks in a wave together (multiple Task
> tool calls in the same message = parallel). **Every implementer subagent MUST use model
> `composer-2.5-fast`** (Composer 2.5). Each implementer follows `superpowers:test-driven-development`
> for every task with a Vitest cycle. Run the task-reviewer gate (spec compliance + code quality) on
> every task as it completes; do **not** dispatch the next wave until every task in the current wave
> has passed review — later waves import files earlier waves create. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Implement the app-authoritative token-credit ledger, Bifrost-wrapping metered client, and
"Usage & Credits" admin dashboard page, per
[`docs/superpowers/specs/2026-08-04-token-credit-accounting-design.md`](../specs/2026-08-04-token-credit-accounting-design.md).

**Architecture:** Six new Postgres tables (`orgs`, `users`, `org_balances`, `user_balances`,
`credit_grants`, `usage_ledger`) seeded with one fixed-UUID dev org/user (no auth exists yet). A new
`ads-agent/lib/metering/` module: `pricing.ts` (pure cost math, zero DB), `types.ts` + `ledger.ts`
(the transactional Postgres ledger), `metered-client.ts` (wraps the existing
`lib/bifrost/client.ts` with a pre-flight balance check + post-call debit). A new
`lib/db/credits.ts` read-query module feeds a new `(admin)/credits` dashboard page (polls every
~15s) with an org/member balance view, an allocate-credits form, and spend breakdowns. Finally,
`campaign-chat.ts` is rewired to call the metered client instead of the bare Bifrost client.

**Tech Stack:** Next.js `ads-agent`, Postgres (`pg`), Vitest, existing Bifrost gateway
(`lib/bifrost/client.ts`), shadcn/ui primitives already installed (`card`, `table`, `badge`, `button`,
`switch`, `alert`), Recharts (already a dependency).

## Global Constraints

- **Model:** every implementer / reviewer subagent uses **`composer-2.5-fast`**. Do not inherit the
  parent session model.
- **No new npm dependencies.** Everything needed (`pg`, `recharts`, shadcn primitives) already exists
  in `ads-agent/package.json`. If a task feels like it needs a new package (forms library, chart
  library, UUID library), it doesn't — use plain `<form>`/`<input>`, Recharts directly (see
  `SpendCplChart.tsx` precedent), and Postgres's own `gen_random_uuid()` / `crypto.randomUUID()`.
- **`debitUsage` and `grantCredits` are the only two functions that open a Postgres transaction**
  (`getPool().connect()` → `BEGIN` → ... → `COMMIT`/`ROLLBACK` → `client.release()`). Every other
  function in this plan (`getOrgBalance`, `getUserCap`, all of `lib/db/credits.ts`) uses the existing
  one-shot `getPool().query(...)` pattern — do not open transactions where a single statement suffices.
- **Follow `ads-agent` conventions exactly:** colocated `*.test.ts`, `vi.mock("../db/client", () => ({
  getPool: () => ({ ... }) }))` (see `lib/db/campaigns.test.ts`), `@/*` → `./*` import alias, camelCase
  TS fields mapped from `snake_case` SQL columns (see every existing `lib/db/*.ts`).
- **Fixed dev seed identity** (no auth system exists): `DEFAULT_ORG_ID =
  "00000000-0000-0000-0000-000000000001"`, `DEFAULT_USER_ID =
  "00000000-0000-0000-0000-000000000002"`, exported from `lib/metering/dev-context.ts`. Every INSERT
  in the schema seed must be idempotent (`ON CONFLICT (id) DO NOTHING` with a **fixed literal id** —
  `credit_grants` normally defaults `id` via `gen_random_uuid()`, so the seed row must override that
  with a fixed literal id or re-running `npm run migrate` will duplicate it).
- **Unknown model pricing fails open, not closed:** `computeCostUsd` returns `0` for a model not in
  the local pricing table rather than throwing — an unlisted/new model must never block a real user
  request. Mark this with a `ponytail:` comment (ceiling: spend from unlisted models is invisible in
  the ledger; upgrade path: add the model to `MODEL_PRICING`).
- **Verify the live Bifrost response shape before trusting it.** The existing `ChatCompletionResponse`
  type has no `usage` field — Task 5 must confirm (via a local `curl` to the running Bifrost, if
  available, or by reading `ads-agent/bifrost/README.md` / Bifrost's OpenAI-compat docs) exactly which
  field names carry token usage and the actually-served model before finalizing the type addition.
  This mirrors the design spec's own finding that Bifrost's cost field wasn't reliably present —
  don't repeat that mistake for `usage`.
- **`ChatCompletionResponse` gets additive-only changes** (`usage?`, `id?`, `model?`) — no existing
  field is removed or renamed; `campaign-chat.ts` and `rationale.ts` keep compiling unmodified except
  where Task 7 explicitly rewires `campaign-chat.ts`.
- **`rationale.ts` stays out of scope** for this plan (per the approved spec's Architecture section,
  which lists only `campaign-chat.ts` as a modified consumer) — do not wire it to the metered client.
- **Money-shaped columns are `NUMERIC`, read back as strings by `pg`** — every DB module in this plan
  must `Number(...)` them before returning, same as every existing `lib/db/*.ts`.

---

## Parallel Execution Plan

```text
Wave 0 (4 parallel)  Task 1 — schema.sql tables + dev seed + dev-context.ts        [Composer 2.5]
                     Task 2 — lib/metering/pricing.ts (+ tests)                    [Composer 2.5]
                     Task 3 — lib/metering/{types,ledger}.ts (+ tests) + concurrency smoke [Composer 2.5]
                     Task 4 — lib/db/credits.ts (+ tests)                          [Composer 2.5]
                        ↓ (all 4 must pass review first)
Wave 1 (2 parallel)  Task 5 — lib/metering/metered-client.ts (+ tests), extends bifrost/client.ts [Composer 2.5]
                     Task 6 — Usage & Credits admin page + allocate form + sidebar entry [Composer 2.5]
                        ↓ (both must pass review first)
Wave 2 (solo)        Task 7 — Wire campaign-chat.ts to the metered client; full suite green [Composer 2.5]
```

Max concurrency = **4** (Wave 0), under the 8-subagent ceiling. Do not invent extra parallel work —
Task 5 genuinely needs Task 2+3's exports at compile time, Task 6 genuinely needs Task 1's seed +
Task 3's `grantCredits` + Task 4's read queries, and Task 7 genuinely needs Task 5's
`callMeteredChatCompletion`. Splitting any of the four Wave 0 tasks further would fragment one
cohesive module across two subagents for no real gain (e.g. `types.ts` is 8 lines and only ever
consumed by `ledger.ts` in the same task).

**Dispatch template (parent):** for each wave, issue one `Task` call per task in the same message with
`model: "composer-2.5-fast"`, `subagent_type: "generalPurpose"`, and a self-contained prompt that
pastes this task's Files / Interfaces / Steps (agents do not inherit parent context).

Each task's **Interfaces** block states exactly what it consumes from an earlier wave and produces for
a later one; siblings within a wave touch disjoint files and never call each other.

---

### Task 1: Schema tables + dev seed + `dev-context.ts`

**Files:**
- Modify: `ads-agent/lib/db/schema.sql`
- Create: `ads-agent/lib/metering/dev-context.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (consumed by Tasks 2–7 as a shared column-name contract, and directly imported by Tasks 3,
  5, 6, 7 for the ID constants): six new tables, seeded with one dev org + user + starting balance +
  matching grant row; `DEFAULT_ORG_ID` / `DEFAULT_USER_ID` constants.

- [ ] **Step 1: Append to `ads-agent/lib/db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'external' CHECK (kind IN ('internal','external')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_balances (
  org_id UUID PRIMARY KEY REFERENCES orgs(id),
  balance_credits NUMERIC NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_balances (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  org_id UUID NOT NULL REFERENCES orgs(id),
  balance_credits NUMERIC NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  user_id UUID REFERENCES users(id),
  amount_credits NUMERIC NOT NULL CHECK (amount_credits > 0),
  granted_by TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  user_id UUID NOT NULL REFERENCES users(id),
  feature TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INT NOT NULL,
  completion_tokens INT NOT NULL,
  total_tokens INT NOT NULL,
  cost_usd NUMERIC NOT NULL,
  credits_debited NUMERIC NOT NULL,
  request_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dev seed: no auth system exists yet, so every metered call runs as this one fixed org/user
-- until a real login flow is built (see design spec Non-goals). Fixed literal ids everywhere so
-- re-running this file (npm run migrate) never duplicates a row.
INSERT INTO orgs (id, name, kind) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Gentle Space (internal)', 'internal')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, org_id, email, display_name, role) VALUES
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'dev@gentlespacesolutions.com', 'Dev User', 'admin')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org_balances (org_id, balance_credits) VALUES
  ('00000000-0000-0000-0000-000000000001', 1000)
ON CONFLICT (org_id) DO NOTHING;

INSERT INTO credit_grants (id, org_id, user_id, amount_credits, granted_by, note) VALUES
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', NULL, 1000,
   'seed', 'Initial dev seed grant')
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Create `ads-agent/lib/metering/dev-context.ts`**

```ts
// No auth system exists yet (see docs/superpowers/specs/2026-08-04-token-credit-accounting-design.md
// Non-goals). Every metered call runs as this one fixed dev org/user, seeded in schema.sql, until a
// real login flow replaces this with the actual authenticated caller.
export const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
export const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000002";
```

- [ ] **Step 3: Apply and verify against the real local Postgres**

```bash
cd ads-agent
docker compose up -d db
npx tsx --env-file=.env.local lib/db/migrate.ts
```

Expected: `ads-agent: schema applied` with no errors. Then confirm the seed is idempotent by running
the same command a second time — still no errors, and:

```bash
docker compose exec db psql -U ads_agent -d ads_agent -c \
  "SELECT (SELECT count(*) FROM orgs) AS orgs, (SELECT count(*) FROM credit_grants) AS grants;"
```

Expected: `orgs = 1`, `grants = 1` (not 2) after running migrate twice.

- [ ] **Step 4: Commit**

```bash
git add ads-agent/lib/db/schema.sql ads-agent/lib/metering/dev-context.ts
git commit -m "$(cat <<'EOF'
feat(ads-agent): add token credit ledger schema with dev seed identity

EOF
)"
```

---

### Task 2: `lib/metering/pricing.ts` + tests

**Files:**
- Create: `ads-agent/lib/metering/pricing.ts`
- Create: `ads-agent/lib/metering/pricing.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, zero DB, zero Bifrost dependency).
- Produces (consumed by Task 5): `computeCostUsd(model, promptTokens, completionTokens): number`,
  `creditsFromCostUsd(costUsd): number`, `usdFromCredits(credits): number`, `CREDITS_PER_USD` constant.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { computeCostUsd, creditsFromCostUsd, usdFromCredits } from "./pricing";

describe("computeCostUsd", () => {
  it("prices a known model from prompt+completion tokens", () => {
    const cost = computeCostUsd("gemini-2.5-flash-lite", 1000, 1000);
    expect(cost).toBeCloseTo(0.0001 + 0.0004, 6);
  });

  it("strips the vertex/ provider prefix before lookup", () => {
    const withPrefix = computeCostUsd("vertex/gemini-2.5-flash", 1000, 1000);
    const withoutPrefix = computeCostUsd("gemini-2.5-flash", 1000, 1000);
    expect(withPrefix).toBe(withoutPrefix);
  });

  it("returns 0 for an unlisted model instead of throwing", () => {
    expect(computeCostUsd("some-future-model", 1000, 1000)).toBe(0);
  });

  it("gemini-2.5-pro costs more per token than flash-lite", () => {
    const lite = computeCostUsd("gemini-2.5-flash-lite", 1000, 1000);
    const pro = computeCostUsd("gemini-2.5-pro", 1000, 1000);
    expect(pro).toBeGreaterThan(lite);
  });
});

describe("credit <-> usd conversion", () => {
  it("round-trips through creditsFromCostUsd and usdFromCredits", () => {
    const credits = creditsFromCostUsd(0.05);
    expect(usdFromCredits(credits)).toBeCloseTo(0.05, 9);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd ads-agent && npx vitest run lib/metering/pricing.test.ts
```

- [ ] **Step 3: Implement `ads-agent/lib/metering/pricing.ts`**

```ts
// Small, explicit per-model $/1K-token map for the only three Vertex models this app routes to
// (see docs/superpowers/specs/2026-08-04-token-credit-accounting-design.md — Bifrost's synchronous
// response doesn't reliably carry a cost field, so cost is computed here from raw token counts).
// Verify against https://cloud.google.com/vertex-ai/generative-ai/pricing before go-live; rates
// change.
export type ModelPricing = { inputPer1k: number; outputPer1k: number };

export const CREDITS_PER_USD = 100; // 1 credit = $0.01

const MODEL_PRICING: Record<string, ModelPricing> = {
  "gemini-2.5-flash-lite": { inputPer1k: 0.0001, outputPer1k: 0.0004 },
  "gemini-2.5-flash": { inputPer1k: 0.0003, outputPer1k: 0.0025 },
  "gemini-2.5-pro": { inputPer1k: 0.00125, outputPer1k: 0.01 },
};

function normalizeModelName(model: string): string {
  return model.includes("/") ? model.split("/").pop()! : model;
}

/**
 * ponytail: unknown model returns 0 rather than throwing, so an unlisted/new model never blocks a
 * real request. Ceiling: spend from an unlisted model is invisible in the ledger. Upgrade path: add
 * the model to MODEL_PRICING above.
 */
export function computeCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[normalizeModelName(model)];
  if (!pricing) return 0;
  return (promptTokens / 1000) * pricing.inputPer1k + (completionTokens / 1000) * pricing.outputPer1k;
}

export function creditsFromCostUsd(costUsd: number): number {
  return costUsd * CREDITS_PER_USD;
}

export function usdFromCredits(credits: number): number {
  return credits / CREDITS_PER_USD;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd ads-agent && npx vitest run lib/metering/pricing.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/metering/pricing.ts ads-agent/lib/metering/pricing.test.ts
git commit -m "$(cat <<'EOF'
feat(ads-agent): add token cost/credit pricing math

EOF
)"
```

---

### Task 3: `lib/metering/{types,ledger}.ts` + tests + concurrency smoke

**Files:**
- Create: `ads-agent/lib/metering/types.ts`
- Create: `ads-agent/lib/metering/ledger.ts`
- Create: `ads-agent/lib/metering/ledger.test.ts`
- Create: `ads-agent/scripts/smoke-metering-concurrency.ts`

**Interfaces:**
- Consumes: `getPool` from `../db/client` (existing). Does **not** import `./pricing` — `debitUsage`
  takes an already-computed `creditsDebited` number; the ledger never does cost math itself.
- Produces (consumed by Tasks 5, 6, 7): `MeteringContext` type, `InsufficientCreditsError` class,
  `getOrgBalance(orgId): Promise<number>`, `getUserCap(userId): Promise<number | null>`,
  `grantCredits(input): Promise<void>`, `debitUsage(input): Promise<void>`.

- [ ] **Step 1: Create `ads-agent/lib/metering/types.ts`**

```ts
export type MeteringContext = { orgId: string; userId: string; feature: string };

export class InsufficientCreditsError extends Error {
  constructor(message = "Insufficient credits") {
    super(message);
    this.name = "InsufficientCreditsError";
  }
}
```

- [ ] **Step 2: Write the failing tests — `ads-agent/lib/metering/ledger.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const poolQuery = vi.fn();
const clientQuery = vi.fn();
const release = vi.fn();
const connect = vi.fn().mockResolvedValue({ query: clientQuery, release });
vi.mock("../db/client", () => ({ getPool: () => ({ query: poolQuery, connect }) }));

import { getOrgBalance, getUserCap, grantCredits, debitUsage } from "./ledger";
import { InsufficientCreditsError } from "./types";

beforeEach(() => {
  poolQuery.mockReset();
  clientQuery.mockReset();
  release.mockReset();
  connect.mockClear();
  clientQuery.mockResolvedValue({ rows: [] });
});

describe("getOrgBalance", () => {
  it("returns 0 when the org has no balance row", async () => {
    poolQuery.mockResolvedValue({ rows: [] });
    await expect(getOrgBalance("org-1")).resolves.toBe(0);
  });

  it("returns the numeric balance when a row exists", async () => {
    poolQuery.mockResolvedValue({ rows: [{ balance_credits: "42.5" }] });
    await expect(getOrgBalance("org-1")).resolves.toBe(42.5);
  });
});

describe("getUserCap", () => {
  it("returns null when the user has no individual cap configured", async () => {
    poolQuery.mockResolvedValue({ rows: [] });
    await expect(getUserCap("user-1")).resolves.toBeNull();
  });

  it("returns the numeric cap when a row exists", async () => {
    poolQuery.mockResolvedValue({ rows: [{ balance_credits: "10" }] });
    await expect(getUserCap("user-1")).resolves.toBe(10);
  });
});

describe("grantCredits", () => {
  it("inserts a grant row and credits the org pool when no userId is given", async () => {
    await grantCredits({ orgId: "org-1", amountCredits: 100, grantedBy: "admin@x.com" });
    expect(clientQuery).toHaveBeenCalledWith("BEGIN");
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO credit_grants"), [
      "org-1",
      null,
      100,
      "admin@x.com",
      null,
    ]);
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE org_balances"), [
      "org-1",
      100,
    ]);
    expect(clientQuery).toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("upserts user_balances when a userId is given", async () => {
    await grantCredits({ orgId: "org-1", userId: "user-1", amountCredits: 50, grantedBy: "admin@x.com" });
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO user_balances"),
      ["user-1", "org-1", 50],
    );
  });

  it("rolls back and rethrows on failure", async () => {
    clientQuery.mockImplementation((sql: string) => {
      if (sql.startsWith("INSERT INTO credit_grants")) throw new Error("db exploded");
      return Promise.resolve({ rows: [] });
    });
    await expect(
      grantCredits({ orgId: "org-1", amountCredits: 10, grantedBy: "x" }),
    ).rejects.toThrow("db exploded");
    expect(clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("debitUsage", () => {
  const baseInput = {
    orgId: "org-1",
    userId: "user-1",
    feature: "ads-agent:campaign-chat",
    provider: "vertex",
    model: "gemini-2.5-flash-lite",
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    costUsd: 0.001,
    creditsDebited: 0.1,
    requestId: "req-1",
  };

  it("locks org_balances FOR UPDATE, debits it, and inserts a usage_ledger row", async () => {
    clientQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM org_balances")) return Promise.resolve({ rows: [{ balance_credits: "5" }] });
      if (sql.includes("FROM user_balances")) return Promise.resolve({ rows: [] }); // no individual cap
      return Promise.resolve({ rows: [] });
    });

    await debitUsage(baseInput);

    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), ["org-1"]);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE org_balances"),
      ["org-1", 0.1],
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO usage_ledger"),
      expect.arrayContaining(["org-1", "user-1", "ads-agent:campaign-chat"]),
    );
    expect(clientQuery).toHaveBeenCalledWith("COMMIT");
  });

  it("also debits user_balances when an individual cap row exists", async () => {
    clientQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM org_balances")) return Promise.resolve({ rows: [{ balance_credits: "5" }] });
      if (sql.includes("FROM user_balances")) return Promise.resolve({ rows: [{ balance_credits: "2" }] });
      return Promise.resolve({ rows: [] });
    });

    await debitUsage(baseInput);

    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE user_balances"),
      ["user-1", 0.1],
    );
  });

  it("throws InsufficientCreditsError when the org has no balance row at all", async () => {
    clientQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM org_balances")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    await expect(debitUsage(baseInput)).rejects.toThrow(InsufficientCreditsError);
    expect(clientQuery).toHaveBeenCalledWith("ROLLBACK");
  });

  it("wraps a CHECK-constraint violation as InsufficientCreditsError and rolls back", async () => {
    clientQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM org_balances")) return Promise.resolve({ rows: [{ balance_credits: "0.01" }] });
      if (sql.includes("FROM user_balances")) return Promise.resolve({ rows: [] });
      if (sql.startsWith("UPDATE org_balances")) throw new Error('new row for relation "org_balances" violates check constraint "org_balances_balance_credits_check"');
      return Promise.resolve({ rows: [] });
    });

    await expect(debitUsage(baseInput)).rejects.toThrow(InsufficientCreditsError);
    expect(clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
cd ads-agent && npx vitest run lib/metering/ledger.test.ts
```

- [ ] **Step 4: Implement `ads-agent/lib/metering/ledger.ts`**

```ts
import { getPool } from "../db/client";
import { InsufficientCreditsError } from "./types";

export async function getOrgBalance(orgId: string): Promise<number> {
  const { rows } = await getPool().query<{ balance_credits: string }>(
    `SELECT balance_credits FROM org_balances WHERE org_id = $1`,
    [orgId],
  );
  return rows[0] ? Number(rows[0].balance_credits) : 0;
}

export async function getUserCap(userId: string): Promise<number | null> {
  const { rows } = await getPool().query<{ balance_credits: string }>(
    `SELECT balance_credits FROM user_balances WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ? Number(rows[0].balance_credits) : null;
}

export async function grantCredits(input: {
  orgId: string;
  userId?: string;
  amountCredits: number;
  grantedBy: string;
  note?: string;
}): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO credit_grants (org_id, user_id, amount_credits, granted_by, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.orgId, input.userId ?? null, input.amountCredits, input.grantedBy, input.note ?? null],
    );
    if (input.userId) {
      await client.query(
        `INSERT INTO user_balances (user_id, org_id, balance_credits)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id)
         DO UPDATE SET balance_credits = user_balances.balance_credits + $3, updated_at = NOW()`,
        [input.userId, input.orgId, input.amountCredits],
      );
    } else {
      await client.query(
        `UPDATE org_balances SET balance_credits = balance_credits + $2, updated_at = NOW()
         WHERE org_id = $1`,
        [input.orgId, input.amountCredits],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function debitUsage(input: {
  orgId: string;
  userId: string;
  feature: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  creditsDebited: number;
  requestId: string | null;
}): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const org = await client.query<{ balance_credits: string }>(
      `SELECT balance_credits FROM org_balances WHERE org_id = $1 FOR UPDATE`,
      [input.orgId],
    );
    if (!org.rows[0]) throw new InsufficientCreditsError(`Org ${input.orgId} has no credit pool`);

    const user = await client.query<{ balance_credits: string }>(
      `SELECT balance_credits FROM user_balances WHERE user_id = $1 FOR UPDATE`,
      [input.userId],
    );
    const hasUserCap = user.rows.length > 0;

    try {
      await client.query(
        `UPDATE org_balances SET balance_credits = balance_credits - $2, updated_at = NOW()
         WHERE org_id = $1`,
        [input.orgId, input.creditsDebited],
      );
      if (hasUserCap) {
        await client.query(
          `UPDATE user_balances SET balance_credits = balance_credits - $2, updated_at = NOW()
           WHERE user_id = $1`,
          [input.userId, input.creditsDebited],
        );
      }
    } catch {
      // The CHECK (balance_credits >= 0) constraint is the final backstop against a race; a
      // violation here means this specific debit would have gone negative.
      throw new InsufficientCreditsError("Debit would exceed available credits");
    }

    await client.query(
      `INSERT INTO usage_ledger
         (org_id, user_id, feature, provider, model, prompt_tokens, completion_tokens,
          total_tokens, cost_usd, credits_debited, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        input.orgId,
        input.userId,
        input.feature,
        input.provider,
        input.model,
        input.promptTokens,
        input.completionTokens,
        input.totalTokens,
        input.costUsd,
        input.creditsDebited,
        input.requestId,
      ],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd ads-agent && npx vitest run lib/metering/ledger.test.ts
```

- [ ] **Step 6: Real-Postgres concurrency smoke — `ads-agent/scripts/smoke-metering-concurrency.ts`**

Mocked unit tests can't prove real row-locking behavior under concurrency (a mock can't simulate two
transactions racing). This script proves the design's success criterion — "concurrent calls against a
near-exhausted balance never leave `balance_credits` negative" — against the real local Postgres.

```ts
import { randomUUID } from "node:crypto";
import { getPool } from "../lib/db/client";
import { grantCredits, debitUsage } from "../lib/metering/ledger";

async function main() {
  const pool = getPool();
  const orgId = randomUUID();
  const userId = randomUUID();

  await pool.query(`INSERT INTO orgs (id, name) VALUES ($1, 'smoke-org')`, [orgId]);
  await pool.query(`INSERT INTO users (id, org_id, email) VALUES ($1, $2, 'smoke@example.com')`, [
    userId,
    orgId,
  ]);
  await pool.query(`INSERT INTO org_balances (org_id, balance_credits) VALUES ($1, 0)`, [orgId]);
  await grantCredits({ orgId, amountCredits: 10, grantedBy: "smoke" });

  // 5 concurrent 3-credit debits against a 10-credit balance: exactly 3 must succeed (9 credits),
  // the other 2 must fail, and the final balance must never go negative.
  const attempts = Array.from({ length: 5 }, (_, i) =>
    debitUsage({
      orgId,
      userId,
      feature: "smoke",
      provider: "vertex",
      model: "gemini-2.5-flash-lite",
      promptTokens: 10,
      completionTokens: 10,
      totalTokens: 20,
      costUsd: 0.001,
      creditsDebited: 3,
      requestId: `smoke-${i}`,
    })
      .then(() => true)
      .catch(() => false),
  );
  const results = await Promise.all(attempts);
  const succeeded = results.filter(Boolean).length;

  const { rows } = await pool.query<{ balance_credits: string }>(
    `SELECT balance_credits FROM org_balances WHERE org_id = $1`,
    [orgId],
  );
  const finalBalance = Number(rows[0].balance_credits);

  console.log(`succeeded: ${succeeded}/5, finalBalance: ${finalBalance}`);

  await pool.query(`DELETE FROM usage_ledger WHERE org_id = $1`, [orgId]);
  await pool.query(`DELETE FROM credit_grants WHERE org_id = $1`, [orgId]);
  await pool.query(`DELETE FROM org_balances WHERE org_id = $1`, [orgId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await pool.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);

  if (finalBalance < 0) {
    console.error("FAIL: balance went negative");
    process.exit(1);
  }
  if (succeeded !== 3) {
    console.error(`FAIL: expected exactly 3 successful debits, got ${succeeded}`);
    process.exit(1);
  }
  console.log("PASS: concurrent debits never went negative");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run it (requires Task 1's schema already applied to the local db):

```bash
cd ads-agent
docker compose up -d db
npx tsx --env-file=.env.local scripts/smoke-metering-concurrency.ts
```

Expected: `PASS: concurrent debits never went negative`. If it prints `succeeded: 5/5` or a negative
final balance, the transaction/locking logic in Step 4 has a bug — fix it before continuing.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/metering/types.ts ads-agent/lib/metering/ledger.ts \
  ads-agent/lib/metering/ledger.test.ts ads-agent/scripts/smoke-metering-concurrency.ts
git commit -m "$(cat <<'EOF'
feat(ads-agent): add race-safe credit ledger with row-locking debit

EOF
)"
```

---

### Task 4: `lib/db/credits.ts` + tests

**Files:**
- Create: `ads-agent/lib/db/credits.ts`
- Create: `ads-agent/lib/db/credits.test.ts`

**Interfaces:**
- Consumes: `getPool` from `./client` (existing).
- Produces (consumed by Task 6): read-only aggregation queries for the dashboard.

```ts
export type OrgBalanceRow = { orgId: string; orgName: string; balanceCredits: number };
export type MemberBalanceRow = {
  userId: string;
  email: string;
  displayName: string | null;
  capCredits: number | null; // null = no individual cap configured
};
export type SpendByKeyRow = { key: string; totalCredits: number; totalCostUsd: number };
export type SpendTrendPoint = { date: string; totalCredits: number };

export async function listOrgBalances(): Promise<OrgBalanceRow[]>;
export async function listMemberBalances(orgId: string): Promise<MemberBalanceRow[]>;
export async function getSpendByFeature(orgId: string, days: number): Promise<SpendByKeyRow[]>;
export async function getSpendByModel(orgId: string, days: number): Promise<SpendByKeyRow[]>;
export async function getSpendTrend(orgId: string, days: number): Promise<SpendTrendPoint[]>;
```

- [ ] **Step 1: Write the failing tests — `ads-agent/lib/db/credits.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import {
  listOrgBalances,
  listMemberBalances,
  getSpendByFeature,
  getSpendByModel,
  getSpendTrend,
} from "./credits";

beforeEach(() => query.mockReset());

describe("listOrgBalances", () => {
  it("returns empty array when there are no orgs", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(listOrgBalances()).resolves.toEqual([]);
  });

  it("maps org rows with numeric balances", async () => {
    query.mockResolvedValue({
      rows: [{ org_id: "org-1", org_name: "Acme", balance_credits: "1000" }],
    });
    await expect(listOrgBalances()).resolves.toEqual([
      { orgId: "org-1", orgName: "Acme", balanceCredits: 1000 },
    ]);
  });
});

describe("listMemberBalances", () => {
  it("returns null capCredits for members with no individual cap row", async () => {
    query.mockResolvedValue({
      rows: [
        { user_id: "u-1", email: "a@x.com", display_name: null, cap_credits: null },
      ],
    });
    const result = await listMemberBalances("org-1");
    expect(result).toEqual([{ userId: "u-1", email: "a@x.com", displayName: null, capCredits: null }]);
    expect(query).toHaveBeenCalledWith(expect.any(String), ["org-1"]);
  });
});

describe("getSpendByFeature / getSpendByModel", () => {
  it("aggregates credits and cost per feature", async () => {
    query.mockResolvedValue({
      rows: [{ key: "ads-agent:campaign-chat", total_credits: "12.5", total_cost_usd: "0.125" }],
    });
    await expect(getSpendByFeature("org-1", 30)).resolves.toEqual([
      { key: "ads-agent:campaign-chat", totalCredits: 12.5, totalCostUsd: 0.125 },
    ]);
  });

  it("aggregates credits and cost per model", async () => {
    query.mockResolvedValue({
      rows: [{ key: "gemini-2.5-flash-lite", total_credits: "5", total_cost_usd: "0.05" }],
    });
    await expect(getSpendByModel("org-1", 30)).resolves.toEqual([
      { key: "gemini-2.5-flash-lite", totalCredits: 5, totalCostUsd: 0.05 },
    ]);
  });
});

describe("getSpendTrend", () => {
  it("returns empty array when there is no usage yet", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getSpendTrend("org-1", 30)).resolves.toEqual([]);
  });

  it("maps day buckets to ISO date strings", async () => {
    query.mockResolvedValue({
      rows: [{ day: new Date("2026-08-04T00:00:00.000Z"), total_credits: "3.2" }],
    });
    await expect(getSpendTrend("org-1", 30)).resolves.toEqual([
      { date: "2026-08-04", totalCredits: 3.2 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd ads-agent && npx vitest run lib/db/credits.test.ts
```

- [ ] **Step 3: Implement `ads-agent/lib/db/credits.ts`**

```ts
import { getPool } from "./client";

export type OrgBalanceRow = { orgId: string; orgName: string; balanceCredits: number };

export async function listOrgBalances(): Promise<OrgBalanceRow[]> {
  const { rows } = await getPool().query<{ org_id: string; org_name: string; balance_credits: string }>(
    `SELECT o.id AS org_id, o.name AS org_name, COALESCE(b.balance_credits, 0) AS balance_credits
     FROM orgs o
     LEFT JOIN org_balances b ON b.org_id = o.id
     ORDER BY o.created_at ASC`,
  );
  return rows.map((row) => ({
    orgId: row.org_id,
    orgName: row.org_name,
    balanceCredits: Number(row.balance_credits),
  }));
}

export type MemberBalanceRow = {
  userId: string;
  email: string;
  displayName: string | null;
  capCredits: number | null;
};

export async function listMemberBalances(orgId: string): Promise<MemberBalanceRow[]> {
  const { rows } = await getPool().query<{
    user_id: string;
    email: string;
    display_name: string | null;
    cap_credits: string | null;
  }>(
    `SELECT u.id AS user_id, u.email, u.display_name, ub.balance_credits AS cap_credits
     FROM users u
     LEFT JOIN user_balances ub ON ub.user_id = u.id
     WHERE u.org_id = $1
     ORDER BY u.created_at ASC`,
    [orgId],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    capCredits: row.cap_credits === null ? null : Number(row.cap_credits),
  }));
}

export type SpendByKeyRow = { key: string; totalCredits: number; totalCostUsd: number };

async function spendByColumn(orgId: string, days: number, column: "feature" | "model"): Promise<SpendByKeyRow[]> {
  const { rows } = await getPool().query<{ key: string; total_credits: string; total_cost_usd: string }>(
    `SELECT ${column} AS key,
            COALESCE(SUM(credits_debited), 0) AS total_credits,
            COALESCE(SUM(cost_usd), 0) AS total_cost_usd
     FROM usage_ledger
     WHERE org_id = $1 AND occurred_at >= NOW() - ($2 || ' days')::interval
     GROUP BY ${column}
     ORDER BY total_credits DESC`,
    [orgId, days],
  );
  return rows.map((row) => ({
    key: row.key,
    totalCredits: Number(row.total_credits),
    totalCostUsd: Number(row.total_cost_usd),
  }));
}

export async function getSpendByFeature(orgId: string, days: number): Promise<SpendByKeyRow[]> {
  return spendByColumn(orgId, days, "feature");
}

export async function getSpendByModel(orgId: string, days: number): Promise<SpendByKeyRow[]> {
  return spendByColumn(orgId, days, "model");
}

export type SpendTrendPoint = { date: string; totalCredits: number };

type TrendRow = { day: Date; total_credits: string };

export async function getSpendTrend(orgId: string, days: number): Promise<SpendTrendPoint[]> {
  const { rows } = await getPool().query<TrendRow>(
    `SELECT date_trunc('day', occurred_at) AS day, COALESCE(SUM(credits_debited), 0) AS total_credits
     FROM usage_ledger
     WHERE org_id = $1 AND occurred_at >= NOW() - ($2 || ' days')::interval
     GROUP BY day
     ORDER BY day ASC`,
    [orgId, days],
  );
  return rows.map((row) => ({
    date: row.day.toISOString().slice(0, 10),
    totalCredits: Number(row.total_credits),
  }));
}
```

Note: `column` is interpolated from a closed, hard-coded union type (`"feature" | "model"`), never
from user input, so there's no injection surface — the same pattern as the existing
`lib/sync/*` query builders in the main app.

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd ads-agent && npx vitest run lib/db/credits.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/db/credits.ts ads-agent/lib/db/credits.test.ts
git commit -m "$(cat <<'EOF'
feat(ads-agent): add credits dashboard read queries

EOF
)"
```

---

### Task 5: `lib/metering/metered-client.ts` + tests (extends `bifrost/client.ts`)

**Files:**
- Modify: `ads-agent/lib/bifrost/client.ts` (additive: `usage`, `id`, `model` on `ChatCompletionResponse`)
- Modify: `ads-agent/lib/bifrost/client.test.ts` (add cases for the new fields only — do not touch
  existing assertions)
- Create: `ads-agent/lib/metering/metered-client.ts`
- Create: `ads-agent/lib/metering/metered-client.test.ts`

**Interfaces:**
- Consumes: `chatCompletion` + types from `../bifrost/client` (Wave 0 unaffected file, now
  additive-extended by this task); `getOrgBalance`, `getUserCap`, `debitUsage` from `./ledger` (Task
  3); `computeCostUsd`, `creditsFromCostUsd` from `./pricing` (Task 2); `MeteringContext`,
  `InsufficientCreditsError` from `./types` (Task 3).
- Produces (consumed by Task 7): `callMeteredChatCompletion(ctx, request):
  Promise<ChatCompletionResponse>`.

- [ ] **Step 0: Verify the live response shape before coding the type change**

If a local Bifrost is running (`docker compose ps bifrost` in `ads-agent/`), curl it directly:

```bash
curl -s http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"vertex/gemini-2.5-flash-lite","messages":[{"role":"user","content":"hi"}],"max_tokens":10}' \
  | python3 -m json.tool
```

Confirm the exact field names for token usage (expected: `usage.prompt_tokens` /
`usage.completion_tokens` / `usage.total_tokens`, OpenAI-compatible) and for the actually-served model
(expected: top-level `model`). If Bifrost is not running locally, read
`ads-agent/bifrost/README.md` and Bifrost's OpenAI-compat docs instead. **If the real field names
differ from the assumption below, use the real names** — do not guess silently; note the discrepancy
in this task's commit message.

- [ ] **Step 1: Extend `ChatCompletionResponse` in `ads-agent/lib/bifrost/client.ts`**

```ts
export type ChatCompletionResponse = {
  id?: string;
  model?: string;
  choices?: { message?: { role?: string; content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  extra_fields?: { provider?: string };
};
```

Add 1-2 cases to `client.test.ts` asserting these fields parse through when present (extend the
existing "chatCompletion POSTs OpenAI-shaped body ... and returns content" fixture with `id`, `model`,
`usage` in the mocked response, and assert `response.usage?.prompt_tokens` reads back correctly). Do
not remove or alter any existing assertion — this is a strictly additive change to a stable public API.

- [ ] **Step 2: Write the failing tests — `ads-agent/lib/metering/metered-client.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const chatCompletion = vi.fn();
vi.mock("../bifrost/client", () => ({ chatCompletion }));

const getOrgBalance = vi.fn();
const getUserCap = vi.fn();
const debitUsage = vi.fn();
vi.mock("./ledger", () => ({ getOrgBalance, getUserCap, debitUsage }));

import { callMeteredChatCompletion } from "./metered-client";
import { InsufficientCreditsError } from "./types";

const ctx = { orgId: "org-1", userId: "user-1", feature: "ads-agent:campaign-chat" };

beforeEach(() => {
  chatCompletion.mockReset();
  getOrgBalance.mockReset();
  getUserCap.mockReset();
  debitUsage.mockReset();
  getOrgBalance.mockResolvedValue(100);
  getUserCap.mockResolvedValue(null);
  debitUsage.mockResolvedValue(undefined);
});

describe("callMeteredChatCompletion", () => {
  it("throws InsufficientCreditsError before calling Bifrost when the org balance is <= 0", async () => {
    getOrgBalance.mockResolvedValue(0);
    await expect(
      callMeteredChatCompletion(ctx, { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(InsufficientCreditsError);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("throws InsufficientCreditsError before calling Bifrost when the user's individual cap is <= 0", async () => {
    getUserCap.mockResolvedValue(0);
    await expect(
      callMeteredChatCompletion(ctx, { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(InsufficientCreditsError);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("calls Bifrost and debits the correct credits from a real usage response", async () => {
    chatCompletion.mockResolvedValue({
      id: "req-123",
      model: "gemini-2.5-flash-lite",
      choices: [{ message: { role: "assistant", content: "hello" } }],
      usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 },
    });

    const response = await callMeteredChatCompletion(ctx, {
      model: "vertex/gemini-2.5-flash-lite",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(response.choices?.[0]?.message?.content).toBe("hello");
    expect(debitUsage).toHaveBeenCalledTimes(1);
    const debitArgs = debitUsage.mock.calls[0][0];
    expect(debitArgs).toMatchObject({
      orgId: "org-1",
      userId: "user-1",
      feature: "ads-agent:campaign-chat",
      provider: "vertex",
      promptTokens: 1000,
      completionTokens: 1000,
      totalTokens: 2000,
      requestId: "req-123",
    });
    expect(debitArgs.costUsd).toBeCloseTo(0.0001 + 0.0004, 6);
    expect(debitArgs.creditsDebited).toBeCloseTo((0.0001 + 0.0004) * 100, 6);
  });

  it("debits 0 credits for an unlisted model instead of throwing", async () => {
    chatCompletion.mockResolvedValue({
      choices: [{ message: { content: "hi" } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
    await callMeteredChatCompletion(ctx, { model: "vertex/some-future-model", messages: [] });
    expect(debitUsage.mock.calls[0][0].costUsd).toBe(0);
    expect(debitUsage.mock.calls[0][0].creditsDebited).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
cd ads-agent && npx vitest run lib/metering/metered-client.test.ts
```

- [ ] **Step 4: Implement `ads-agent/lib/metering/metered-client.ts`**

```ts
import { chatCompletion, type ChatCompletionOptions, type ChatCompletionResponse } from "../bifrost/client";
import { getOrgBalance, getUserCap, debitUsage } from "./ledger";
import { computeCostUsd, creditsFromCostUsd } from "./pricing";
import { InsufficientCreditsError, type MeteringContext } from "./types";

export async function callMeteredChatCompletion(
  ctx: MeteringContext,
  request: ChatCompletionOptions,
): Promise<ChatCompletionResponse> {
  const orgBalance = await getOrgBalance(ctx.orgId);
  if (orgBalance <= 0) {
    throw new InsufficientCreditsError(`Org ${ctx.orgId} has no remaining credits`);
  }

  const userCap = await getUserCap(ctx.userId);
  if (userCap !== null && userCap <= 0) {
    throw new InsufficientCreditsError(`User ${ctx.userId} has exhausted their individual credit cap`);
  }

  const response = await chatCompletion(request);

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;
  const totalTokens = response.usage?.total_tokens ?? promptTokens + completionTokens;
  const model = response.model || request.model || "unknown";
  const costUsd = computeCostUsd(model, promptTokens, completionTokens);
  const creditsDebited = creditsFromCostUsd(costUsd);

  await debitUsage({
    orgId: ctx.orgId,
    userId: ctx.userId,
    feature: ctx.feature,
    provider: "vertex",
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd,
    creditsDebited,
    requestId: response.id ?? null,
  });

  return response;
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd ads-agent && npx vitest run lib/bifrost/client.test.ts lib/metering/metered-client.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add ads-agent/lib/bifrost/client.ts ads-agent/lib/bifrost/client.test.ts \
  ads-agent/lib/metering/metered-client.ts ads-agent/lib/metering/metered-client.test.ts
git commit -m "$(cat <<'EOF'
feat(ads-agent): add metered Bifrost client with pre-flight credit check

EOF
)"
```

---

### Task 6: Usage & Credits admin page + allocate form + sidebar entry

**Files:**
- Create: `ads-agent/app/(admin)/credits/page.tsx`
- Create: `ads-agent/app/(admin)/credits/AllocateCreditsForm.tsx`
- Create: `ads-agent/app/(admin)/credits/UsagePoller.tsx`
- Create: `ads-agent/app/api/credits/grant/route.ts`
- Create: `ads-agent/app/api/credits/grant/route.test.ts`
- Modify: `ads-agent/components/SidebarNav.tsx`

**Interfaces:**
- Consumes: `listOrgBalances`, `listMemberBalances`, `getSpendByFeature`, `getSpendByModel`,
  `getSpendTrend` from `@/lib/db/credits` (Task 4); `grantCredits` from `@/lib/metering/ledger` (Task
  3); `DEFAULT_ORG_ID` from `@/lib/metering/dev-context` (Task 1, since there's no org-switcher UI
  yet — this page shows the one seeded org).
- Produces: nothing consumed by later tasks (leaf UI).

- [ ] **Step 1: `ads-agent/app/api/credits/grant/route.ts`**

```ts
import { NextResponse } from "next/server";
import { grantCredits } from "@/lib/metering/ledger";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    orgId?: unknown;
    userId?: unknown;
    amountCredits?: unknown;
    note?: unknown;
  };
  if (typeof body.orgId !== "string" || !body.orgId) {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  }
  if (typeof body.amountCredits !== "number" || !(body.amountCredits > 0)) {
    return NextResponse.json({ error: "amountCredits must be a positive number" }, { status: 400 });
  }
  await grantCredits({
    orgId: body.orgId,
    userId: typeof body.userId === "string" && body.userId ? body.userId : undefined,
    amountCredits: body.amountCredits,
    grantedBy: "admin", // no auth system yet — see design spec Non-goals
    note: typeof body.note === "string" && body.note ? body.note : undefined,
  });
  return NextResponse.json({ ok: true });
}
```

Test file `route.test.ts` — mirror `app/api/settings/route.test.ts`'s convention (`vi.mock` the ledger
module, POST a `Request`, assert status + body for: valid grant, missing `orgId`, non-positive
`amountCredits`).

- [ ] **Step 2: `ads-agent/app/(admin)/credits/AllocateCreditsForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function AllocateCreditsForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amountCredits = Number(amount);
    if (!(amountCredits > 0)) {
      setError("Enter a positive number of credits.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/credits/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, amountCredits }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to allocate credits.");
        return;
      }
      setAmount("");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="amount" className="text-xs font-medium text-muted-foreground">
          Allocate credits
        </label>
        <input
          id="amount"
          type="number"
          min="1"
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="1000"
          className="h-9 w-32 rounded-md border border-border bg-background px-3 text-sm"
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Allocating…" : "Allocate"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 3: `ads-agent/app/(admin)/credits/UsagePoller.tsx`** (plain-JS interval refresh, no new dependency)

```tsx
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
```

- [ ] **Step 4: `ads-agent/app/(admin)/credits/page.tsx`**

```tsx
import {
  getSpendByFeature,
  getSpendByModel,
  getSpendTrend,
  listMemberBalances,
  listOrgBalances,
} from "@/lib/db/credits";
import { DEFAULT_ORG_ID } from "@/lib/metering/dev-context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AllocateCreditsForm } from "./AllocateCreditsForm";
import { UsagePoller } from "./UsagePoller";

function formatCredits(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default async function CreditsPage() {
  const [orgBalances, members, spendByFeature, spendByModel, trend] = await Promise.all([
    listOrgBalances(),
    listMemberBalances(DEFAULT_ORG_ID),
    getSpendByFeature(DEFAULT_ORG_ID, 30),
    getSpendByModel(DEFAULT_ORG_ID, 30),
    getSpendTrend(DEFAULT_ORG_ID, 30),
  ]);

  const org = orgBalances.find((o) => o.orgId === DEFAULT_ORG_ID);

  return (
    <div className="flex flex-col gap-6">
      <UsagePoller />

      {orgBalances.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No organizations yet.
          </CardContent>
        </Card>
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
            <AllocateCreditsForm orgId={DEFAULT_ORG_ID} />
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Members</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold text-foreground">Spend by feature (30d)</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold text-foreground">Spend by model (30d)</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground">Daily spend, last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}
```

(A Recharts line chart for the trend, matching `SpendCplChart.tsx`, is a nice-to-have polish pass —
the table above already satisfies the design spec's UI-states requirement; swap it for a chart in
review if time allows, following the exact `SpendCplChart.tsx` pattern.)

- [ ] **Step 5: Add sidebar nav entry — `ads-agent/components/SidebarNav.tsx`**

```ts
import { CreditCard, ... } from "lucide-react"; // add CreditCard to the existing import

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/proposals", label: "Proposals", icon: ClipboardList },
  { href: "/credits", label: "Usage & Credits", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];
```

- [ ] **Step 6: Run tests, typecheck, and manually verify**

```bash
cd ads-agent
npx vitest run app/api/credits/grant/route.test.ts
npx tsc --noEmit
npm run dev
```

Visit `http://localhost:3030/credits` — expect the seeded org (`Gentle Space (internal)`) showing
1000 credits, one member (`Dev User`), empty spend tables ("No usage yet."). Allocate 500 more
credits via the form; confirm the balance updates to 1500 after the page refreshes.

- [ ] **Step 7: Commit**

```bash
git add "ads-agent/app/(admin)/credits" ads-agent/app/api/credits ads-agent/components/SidebarNav.tsx
git commit -m "$(cat <<'EOF'
feat(ads-agent): add Usage & Credits admin dashboard page

EOF
)"
```

---

### Task 7: Wire `campaign-chat.ts` to the metered client; full suite green

**Files:**
- Modify: `ads-agent/lib/decision-engine/campaign-chat.ts`
- Modify: `ads-agent/lib/decision-engine/campaign-chat.test.ts`

**Interfaces:**
- Consumes: `callMeteredChatCompletion` from `../metering/metered-client` (Task 5);
  `InsufficientCreditsError` from `../metering/types` (Task 3); `DEFAULT_ORG_ID`, `DEFAULT_USER_ID`
  from `../metering/dev-context` (Task 1).
- Produces: same public API `draftCampaignChatReply(input): Promise<ChatReply>` — signature
  unchanged; metering happens internally using the fixed dev identity (no auth exists yet).

- [ ] **Step 1: Rewrite `campaign-chat.test.ts` to mock the metering seam directly**

Replace the `fetch`-mocking convention with a direct mock of `callMeteredChatCompletion` (simpler and
decouples this test file from ledger/DB concerns entirely):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignDraft } from "../types";

const callMeteredChatCompletion = vi.fn();
vi.mock("../metering/metered-client", () => ({ callMeteredChatCompletion }));
vi.mock("../bifrost/client", async () => {
  const actual = await vi.importActual<typeof import("../bifrost/client")>("../bifrost/client");
  return { ...actual, isBifrostConfigured: () => true };
});

function draft(overrides: Partial<CampaignDraft> = {}): CampaignDraft { /* unchanged */ }

function jsonResponse(payload: Record<string, unknown>) {
  return { choices: [{ message: { role: "assistant", content: JSON.stringify(payload) } }] };
}

beforeEach(() => {
  callMeteredChatCompletion.mockReset();
});
```

Update every test body to `callMeteredChatCompletion.mockResolvedValue(jsonResponse({...}))` instead
of `vi.stubGlobal("fetch", ...)`, and update body-shape assertions to inspect
`callMeteredChatCompletion.mock.calls[0][1]` (the `request` argument) instead of parsing a `fetch`
body — e.g. `expect(callMeteredChatCompletion.mock.calls[0][1].responseFormat.type).toBe("json_schema")`
and `expect(callMeteredChatCompletion.mock.calls[0][0]).toEqual({ orgId: DEFAULT_ORG_ID, userId:
DEFAULT_USER_ID, feature: "ads-agent:campaign-chat" })`. Keep every existing behavioral case
(clarifying question, field updates, RSA retry, sanitize, descriptions top-up) — only the mocking seam
changes.

Add one new case:

```ts
it("returns a friendly message and no field updates when credits are exhausted", async () => {
  const { InsufficientCreditsError } = await import("../metering/types");
  callMeteredChatCompletion.mockRejectedValue(new InsufficientCreditsError("out of credits"));
  const { draftCampaignChatReply } = await import("./campaign-chat");
  const result = await draftCampaignChatReply({ draft: draft(), history: [], userMessage: "hi" });
  expect(result.fieldUpdates).toBeNull();
  expect(result.reply).toMatch(/credit/i);
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd ads-agent && npx vitest run lib/decision-engine/campaign-chat.test.ts
```

- [ ] **Step 3: Rewrite `campaign-chat.ts`**

Key changes (preserve every existing helper — `DRAFT_RESPONSE_SCHEMA`, `DESCRIPTIONS_TOPUP_SCHEMA`,
`parseDraftJson`, `sanitizeReply`, `wantsAdCopy`, `wantsDescriptionsOnly`, `buildMessages`, RSA
validation retry — only the transport call changes):

1. Import `callMeteredChatCompletion` from `../metering/metered-client`, `InsufficientCreditsError`
   from `../metering/types`, `DEFAULT_ORG_ID`/`DEFAULT_USER_ID` from `../metering/dev-context`.
2. Build the metering context once per call: `const ctx = { orgId: DEFAULT_ORG_ID, userId:
   DEFAULT_USER_ID, feature: "ads-agent:campaign-chat" }`.
3. `callDraftModel` takes `ctx` as its first parameter and calls `callMeteredChatCompletion(ctx, {
   messages, temperature: 0.3, maxTokens: 2048, responseFormat: {...}, timeoutMs: 20_000 })` instead of
   the bare `chatCompletion`.
4. Every existing `try { ... } catch { return { reply: "The campaign assistant is unavailable..." } }`
   block around a `callDraftModel` call gains an `InsufficientCreditsError` branch first:

```ts
try {
  first = await callDraftModel(ctx, messages);
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    return {
      reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits.",
      fieldUpdates: null,
      validationErrors: [],
    };
  }
  return { reply: "The campaign assistant is unavailable right now — try again shortly.", fieldUpdates: null, validationErrors: [] };
}
```

Apply the same branch to the retry call site and inside `topUpDescriptions`'s catch block (which
currently swallows all errors and returns `null` — let `InsufficientCreditsError` propagate out of
`topUpDescriptions` instead of being swallowed, so the caller's catch block can produce the friendly
message; `topUpDescriptions`'s own signature also gains `ctx` as its first parameter).

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd ads-agent && npx vitest run lib/decision-engine/campaign-chat.test.ts
```

- [ ] **Step 5: Full suite + lint + typecheck**

```bash
cd ads-agent
npm test
npm run lint
npx tsc --noEmit
```

Expected: all green, zero new warnings.

- [ ] **Step 6: Manual end-to-end smoke (requires Bifrost + db running)**

```bash
cd ads-agent
docker compose up -d db bifrost
npm run dev
```

Open a campaign draft chat in the UI, send a message, confirm a reply comes back and
`http://localhost:3030/credits` shows the balance decreased and a new `usage_ledger` row (spend-by-
feature table now shows `ads-agent:campaign-chat`). Then manually zero out the seeded org's balance
(`UPDATE org_balances SET balance_credits = 0 WHERE org_id = '00000000-0000-0000-0000-000000000001'`)
and confirm the chat now returns the "out of AI credits" message instead of calling Bifrost. Restore
the balance afterward (`grantCredits` via the dashboard form, or re-run migrate against a fresh db).

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/decision-engine/campaign-chat.ts ads-agent/lib/decision-engine/campaign-chat.test.ts
git commit -m "$(cat <<'EOF'
feat(ads-agent): meter campaign chat against the org credit ledger

EOF
)"
```

- [ ] **Step 8: Parent session — store openmemory + update `openmemory.md`**

After Task 7, the **parent** (not a subagent) updates the existing "Token credit accounting design
approved" entry in `openmemory.md` to note it's now **implemented**, and stores a project-fact memory
covering: the six new tables + dev seed identity, the `lib/metering/` module boundaries, and the
`(admin)/credits` page location.

---

## Spec coverage checklist (self-review)

| Spec requirement | Task |
|---|---|
| `orgs`/`users` minimal identity model | 1 |
| `org_balances`/`user_balances`/`credit_grants`/`usage_ledger` tables | 1 |
| Abstract credit unit at a fixed `CREDITS_PER_USD` rate | 2 |
| Race-safe `debitUsage` (row-locking transaction) | 3 |
| `grantCredits` (org pool + optional per-user cap) | 3 |
| Real-concurrency proof (no negative balance) | 3 |
| Dashboard read queries (balances, spend by feature/model, trend) | 4 |
| Pre-flight balance check before calling Bifrost | 5 |
| Debit computed from Bifrost's actual `usage` tokens | 5 |
| "Usage & Credits" admin page, org/member view, allocate action | 6 |
| Poll-refresh (~15s) | 6 |
| Sidebar nav entry | 6 |
| `campaign-chat.ts` metered, friendly out-of-credits message | 7 |
| `rationale.ts` and main-site anonymous Vertex calls out of scope | enforced in Global Constraints |
| No real auth built (dev seed identity only) | 1, 7 |

## Placeholder scan

No TBD/TODO steps. Every code step includes concrete code. One deliberate open question is flagged
explicitly rather than guessed at: Task 5 Step 0 requires empirically confirming Bifrost's actual
`usage`/`model` field names before finalizing the type change, given the spec's own prior finding that
Bifrost's cost field wasn't reliably present in this version.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-04-token-credit-accounting.md`.**

**Recommended execution:** Subagent-Driven with **parallel waves** + **Composer 2.5**
(`composer-2.5-fast` on every Task call), per the Parallel Execution Plan above.

1. **Subagent-Driven (recommended)** — parent dispatches Wave 0's 4 tasks in one message, reviews all
   four, then Wave 1's 2 tasks, then Wave 2's solo task.
2. **Inline Execution** — same waves, but implemented in this session without subagents.

**Which approach?**
