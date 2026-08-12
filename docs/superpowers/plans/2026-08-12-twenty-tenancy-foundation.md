# Twenty Tenancy Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Twenty access tenant-resolved, so that when the enquiry spine lands it writes to
a per-org Twenty instance through one guarded client rather than three process-wide singletons.

**Architecture:** A `context.twenty_connections` registry maps org to instance; `getTwentyClient(orgId)`
is the only way to reach Twenty and throws rather than returning empty; `adsagent.contacts` caches the
identity fields Twenty owns. The three existing singleton access paths collapse into that client and
the MCP sidecar is deleted.

**Tech Stack:** TypeScript, Next.js, `pg` ^8.22.0, `zod` ^4.4.3, vitest ^4.1.10, PostgreSQL, Coolify.

## Preconditions

**S1–S3 must be complete before Task 1.** This plan assumes the `adsagent`, `context` and `public`
schemas exist, every domain table carries `org_id`, RLS is enforced, and a server-resolved tenant is
available to request handlers. Written ahead of time deliberately; do not start it early.

**Not in scope — already covered by `2026-08-12-s1-s3-foundation.md` unit U8:** the scope-parameter
conversion of `twenty-pipeline.ts` and the interim platform-only guard. This plan replaces that
interim guard with real per-tenant resolution; it does not re-do it.

## Global Constraints

- `ads-agent/lib/db/schema.sql` is applied **wholesale on every run** by `lib/db/migrate.ts`. Every
  statement must be idempotent — `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. A non-idempotent statement breaks every deploy.
- Twenty owns identity; Postgres owns everything that happens. On identity fields Twenty wins.
- No code may construct a Twenty base URL or read `TWENTY_API_KEY` directly after Task 5.
- `getTwentyClient` **throws**; it never returns an empty result. An empty pipeline and an unreachable
  one must never be indistinguishable — that ambiguity is how both a UX bug and a tenancy leak hide.
- The `org_id` passed to any Twenty call comes from the server-resolved tenant, never a request
  parameter.
- Secrets are referenced, never stored: `api_key_ref` is a pointer. Open question B4 (pgcrypto vs KMS)
  must be answerable later without a schema change.
- Tests run with `cd ads-agent && npx vitest run <path>`.

## Parallel execution map

Six waves. Wave 5 is where the parallelism pays — seven independent call sites, one agent each.

| Wave | Tasks | Parallel agents | Gate before next wave |
|---|---|---|---|
| 1 | T1 | 1 | schema applies twice cleanly |
| 2 | T2, T3, T4 | 3 | data layers green in isolation |
| 3 | T5 | 1 | the client throws on every non-active state |
| 4 | T6a–T6c | 3 | the three modules take `orgId` |
| 5 | T7a–T7g | **7** | every call site passes its own test |
| 6 | T8, T9 | 2 | cross-tenant suite green; sidecar gone |

Maximum concurrent agents: **7** (wave 5), within the 8 ceiling.

### Skills per agent

| Task | Skills | Why |
|---|---|---|
| T1 | `postgres-pro`, `database-designer` | idempotent DDL, index and RLS design |
| T2 | `senior-backend`, `security-auditor` | secret handling is the failure mode |
| T3, T4 | `senior-backend`, `typescript-pro` | data layers with typed boundaries |
| T5 | `senior-backend`, `security-auditor` | the guard is the tenancy boundary |
| T6a–c | `refactoring-specialist`, `typescript-pro` | mechanical signature conversion |
| T7a–d | `senior-backend` | routes and server modules |
| T7e–g | `senior-frontend`, `react-specialist` | server components and UI states |
| T8 | `senior-qa`, `tdd-guide` | cross-tenant suite |
| T9 | `senior-devops`, `docker-expert` | compose and Coolify |
| Review | `code-reviewer`; `security-review` on T5 and T8 | two-stage review |

---

## Task 1: Schema — contacts and the connection registry

**Files:**
- Modify: `ads-agent/lib/db/schema.sql` (append)
- Test: `ads-agent/lib/db/schema.twenty.test.ts`

**Interfaces:**
- Produces: tables `adsagent.contacts` and `context.twenty_connections` with the columns used by
  Tasks 3 and 4.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/db/schema.twenty.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const sql = readFileSync(path.join(process.cwd(), "lib/db/schema.sql"), "utf-8");

describe("twenty tenancy schema", () => {
  it("creates both tables idempotently", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS adsagent.contacts");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS context.twenty_connections");
  });

  it("never stores the api key itself", () => {
    expect(sql).toContain("api_key_ref");
    expect(sql).not.toMatch(/api_key\s+TEXT/);
  });

  it("keeps a tombstone path for dedup merges", () => {
    expect(sql).toContain("merged_into");
    expect(sql).toContain("merged_away");
  });

  it("enables row level security on contacts", () => {
    expect(sql).toContain("ALTER TABLE adsagent.contacts ENABLE ROW LEVEL SECURITY");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/db/schema.twenty.test.ts`
Expected: FAIL — all four assertions, the strings are absent.

- [ ] **Step 3: Append the schema**

```sql
-- ===== Twenty tenancy foundation =====
-- Cache of the identity fields Twenty owns. Rebuildable, but it holds personal
-- data and is not exempt from retention rules.
CREATE TABLE IF NOT EXISTS adsagent.contacts (
  id               UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id           UUID NOT NULL REFERENCES public.orgs(id),
  twenty_person_id TEXT,
  name             TEXT NOT NULL,
  phone            TEXT,
  email            TEXT,
  synced_at        TIMESTAMPTZ,
  sync_state       TEXT NOT NULL DEFAULT 'pending'
                     CHECK (sync_state IN ('pending','synced','failed','merged_away')),
  -- Set when Twenty merges this person into another. The row survives so that
  -- existing enquiry references keep resolving.
  merged_into      UUID REFERENCES adsagent.contacts(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, twenty_person_id)
);

CREATE INDEX IF NOT EXISTS contacts_unsynced_idx
  ON adsagent.contacts (org_id, sync_state) WHERE sync_state <> 'synced';

ALTER TABLE adsagent.contacts ENABLE ROW LEVEL SECURITY;

-- One provisioned Twenty instance per org.
CREATE TABLE IF NOT EXISTS context.twenty_connections (
  org_id               UUID PRIMARY KEY REFERENCES public.orgs(id),
  base_url             TEXT NOT NULL,
  -- A pointer into the secret store, never the key. Lets open question B4
  -- settle later without a migration.
  api_key_ref          TEXT NOT NULL,
  coolify_service_uuid TEXT NOT NULL UNIQUE,
  twenty_version       TEXT NOT NULL,
  state                TEXT NOT NULL DEFAULT 'provisioning'
                         CHECK (state IN
                           ('provisioning','active','suspended','deprovisioned','failed')),
  provisioned_at       TIMESTAMPTZ,
  last_sync_at         TIMESTAMPTZ,
  last_error           TEXT
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/db/schema.twenty.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify idempotency against a real database**

Run: `cd ads-agent && npm run migrate && npm run migrate`
Expected: `ads-agent: schema applied` twice, no error. A failure on the second run means a statement
is missing `IF NOT EXISTS`.

- [ ] **Step 6: Commit**

```bash
git add ads-agent/lib/db/schema.sql ads-agent/lib/db/schema.twenty.test.ts
git commit -m "feat(db): contacts cache and per-org Twenty connection registry"
```

---

## Task 2: Secret resolution adapter

**Files:**
- Create: `ads-agent/lib/secrets/resolver.ts`
- Test: `ads-agent/lib/secrets/resolver.test.ts`

**Interfaces:**
- Produces: `resolveSecret(ref: string): Promise<string>` — Task 5 consumes it.

An adapter exists so open question B4 can be answered later. Today it reads env vars; when B4 settles
on pgcrypto or KMS, only this file changes.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/secrets/resolver.test.ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveSecret } from "./resolver";

afterEach(() => vi.unstubAllEnvs());

describe("resolveSecret", () => {
  it("resolves an env: reference", async () => {
    vi.stubEnv("TWENTY_KEY_ACME", "sk-live-123");
    await expect(resolveSecret("env:TWENTY_KEY_ACME")).resolves.toBe("sk-live-123");
  });

  it("throws when the referenced variable is missing", async () => {
    await expect(resolveSecret("env:NOT_SET")).rejects.toThrow(/NOT_SET/);
  });

  it("rejects an unknown scheme rather than guessing", async () => {
    await expect(resolveSecret("kms:projects/x/keys/y")).rejects.toThrow(/unsupported/i);
  });

  it("rejects a bare value, so a raw key can never be mistaken for a reference", async () => {
    await expect(resolveSecret("sk-live-123")).rejects.toThrow(/unsupported/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/secrets/resolver.test.ts`
Expected: FAIL — `Cannot find module './resolver'`.

- [ ] **Step 3: Write the implementation**

```ts
// ads-agent/lib/secrets/resolver.ts

/**
 * Resolves a secret reference to its value.
 *
 * References carry an explicit scheme so a raw secret can never be mistaken for
 * a reference: "env:NAME" reads process.env.NAME. When open question B4 settles
 * (pgcrypto in-database vs KMS envelope encryption) a "kms:" scheme is added
 * here and nothing else changes.
 */
export async function resolveSecret(ref: string): Promise<string> {
  const separator = ref.indexOf(":");
  const scheme = separator === -1 ? "" : ref.slice(0, separator);

  if (scheme !== "env") {
    throw new Error(`unsupported secret reference scheme: ${ref.slice(0, 12)}`);
  }

  const name = ref.slice(separator + 1);
  const value = process.env[name];
  if (!value) throw new Error(`secret reference ${name} is not set`);
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/secrets/resolver.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/secrets/
git commit -m "feat(secrets): reference-based secret resolver, pending B4"
```

---

## Task 3: Connection registry data layer

**Files:**
- Create: `ads-agent/lib/db/twenty-connections.ts`
- Test: `ads-agent/lib/db/twenty-connections.test.ts`

**Interfaces:**
- Consumes: `adsagent`/`context` schema from Task 1.
- Produces: `getTwentyConnection(orgId: string): Promise<TwentyConnection | null>` and the
  `TwentyConnection` / `TwentyConnectionState` types. Task 5 consumes both.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/db/twenty-connections.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import { getTwentyConnection } from "./twenty-connections";

beforeEach(() => query.mockReset());

describe("getTwentyConnection", () => {
  it("returns null when the org has no connection", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getTwentyConnection("org-1")).resolves.toBeNull();
  });

  it("maps snake_case columns to camelCase fields", async () => {
    query.mockResolvedValue({
      rows: [{
        org_id: "org-1",
        base_url: "https://crm-acme.example.com",
        api_key_ref: "env:TWENTY_KEY_ACME",
        coolify_service_uuid: "svc-abc",
        twenty_version: "1.4.0",
        state: "active",
      }],
    });
    await expect(getTwentyConnection("org-1")).resolves.toEqual({
      orgId: "org-1",
      baseUrl: "https://crm-acme.example.com",
      apiKeyRef: "env:TWENTY_KEY_ACME",
      coolifyServiceUuid: "svc-abc",
      twentyVersion: "1.4.0",
      state: "active",
    });
  });

  it("scopes the query by org_id", async () => {
    query.mockResolvedValue({ rows: [] });
    await getTwentyConnection("org-1");
    expect(query.mock.calls[0][1]).toEqual(["org-1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/db/twenty-connections.test.ts`
Expected: FAIL — `Cannot find module './twenty-connections'`.

- [ ] **Step 3: Write the implementation**

```ts
// ads-agent/lib/db/twenty-connections.ts
import { getPool } from "./client";

export type TwentyConnectionState =
  | "provisioning"
  | "active"
  | "suspended"
  | "deprovisioned"
  | "failed";

export type TwentyConnection = {
  orgId: string;
  baseUrl: string;
  apiKeyRef: string;
  coolifyServiceUuid: string;
  twentyVersion: string;
  state: TwentyConnectionState;
};

export async function getTwentyConnection(orgId: string): Promise<TwentyConnection | null> {
  const { rows } = await getPool().query(
    `SELECT org_id, base_url, api_key_ref, coolify_service_uuid, twenty_version, state
       FROM context.twenty_connections
      WHERE org_id = $1`,
    [orgId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    orgId: row.org_id,
    baseUrl: row.base_url,
    apiKeyRef: row.api_key_ref,
    coolifyServiceUuid: row.coolify_service_uuid,
    twentyVersion: row.twenty_version,
    state: row.state,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/db/twenty-connections.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/db/twenty-connections.ts ads-agent/lib/db/twenty-connections.test.ts
git commit -m "feat(db): per-org Twenty connection lookup"
```

---

## Task 4: Contacts data layer

**Files:**
- Create: `ads-agent/lib/db/contacts.ts`
- Test: `ads-agent/lib/db/contacts.test.ts`

**Interfaces:**
- Consumes: `adsagent.contacts` from Task 1.
- Produces: `resolveContact(orgId, contactId)` which follows one merge hop, and
  `markMerged(orgId, losingId, survivingId)`.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/db/contacts.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import { resolveContact, markMerged } from "./contacts";

beforeEach(() => query.mockReset());

const row = (over: Record<string, unknown> = {}) => ({
  id: "c-1", org_id: "org-1", twenty_person_id: "p-1", name: "Rajesh",
  phone: "+919000000000", email: null, sync_state: "synced", merged_into: null, ...over,
});

describe("resolveContact", () => {
  it("returns the contact when it has not been merged", async () => {
    query.mockResolvedValueOnce({ rows: [row()] });
    const c = await resolveContact("org-1", "c-1");
    expect(c?.id).toBe("c-1");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("follows exactly one merge hop to the survivor", async () => {
    query
      .mockResolvedValueOnce({ rows: [row({ sync_state: "merged_away", merged_into: "c-2" })] })
      .mockResolvedValueOnce({ rows: [row({ id: "c-2" })] });
    const c = await resolveContact("org-1", "c-1");
    expect(c?.id).toBe("c-2");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("throws on a merge chain rather than following it recursively", async () => {
    query
      .mockResolvedValueOnce({ rows: [row({ sync_state: "merged_away", merged_into: "c-2" })] })
      .mockResolvedValueOnce({ rows: [row({ id: "c-2", sync_state: "merged_away", merged_into: "c-3" })] });
    await expect(resolveContact("org-1", "c-1")).rejects.toThrow(/merge chain/i);
  });

  it("returns null for an unknown contact", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(resolveContact("org-1", "nope")).resolves.toBeNull();
  });
});

describe("markMerged", () => {
  it("scopes the update by org and records the survivor", async () => {
    query.mockResolvedValue({ rows: [] });
    await markMerged("org-1", "c-1", "c-2");
    expect(query.mock.calls[0][1]).toEqual(["org-1", "c-1", "c-2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/db/contacts.test.ts`
Expected: FAIL — `Cannot find module './contacts'`.

- [ ] **Step 3: Write the implementation**

```ts
// ads-agent/lib/db/contacts.ts
import { getPool } from "./client";

export type ContactSyncState = "pending" | "synced" | "failed" | "merged_away";

export type Contact = {
  id: string;
  orgId: string;
  twentyPersonId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  syncState: ContactSyncState;
  mergedInto: string | null;
};

function toContact(row: Record<string, unknown>): Contact {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    twentyPersonId: (row.twenty_person_id as string) ?? null,
    name: row.name as string,
    phone: (row.phone as string) ?? null,
    email: (row.email as string) ?? null,
    syncState: row.sync_state as ContactSyncState,
    mergedInto: (row.merged_into as string) ?? null,
  };
}

async function fetchOne(orgId: string, id: string): Promise<Contact | null> {
  const { rows } = await getPool().query(
    `SELECT id, org_id, twenty_person_id, name, phone, email, sync_state, merged_into
       FROM adsagent.contacts
      WHERE org_id = $1 AND id = $2`,
    [orgId, id],
  );
  return rows.length === 0 ? null : toContact(rows[0]);
}

/**
 * Resolves a contact, following a single merge hop when Twenty's deduplication
 * has folded this person into another. One hop only: a chain means a merge was
 * recorded against an already-merged row, which is a bug worth surfacing rather
 * than papering over with recursion.
 */
export async function resolveContact(orgId: string, contactId: string): Promise<Contact | null> {
  const first = await fetchOne(orgId, contactId);
  if (!first || first.syncState !== "merged_away" || !first.mergedInto) return first;

  const survivor = await fetchOne(orgId, first.mergedInto);
  if (survivor?.syncState === "merged_away") {
    throw new Error(`merge chain detected: ${contactId} -> ${first.mergedInto} -> ...`);
  }
  return survivor;
}

export async function markMerged(
  orgId: string,
  losingId: string,
  survivingId: string,
): Promise<void> {
  await getPool().query(
    `UPDATE adsagent.contacts
        SET sync_state = 'merged_away', merged_into = $3, synced_at = now()
      WHERE org_id = $1 AND id = $2`,
    [orgId, losingId, survivingId],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/db/contacts.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/db/contacts.ts ads-agent/lib/db/contacts.test.ts
git commit -m "feat(db): contacts with single-hop merge resolution"
```

---

## Task 5: The tenant-resolving Twenty client

**Files:**
- Create: `ads-agent/lib/crm/twenty-client.ts`
- Test: `ads-agent/lib/crm/twenty-client.test.ts`

**Interfaces:**
- Consumes: `getTwentyConnection` (T3), `resolveSecret` (T2).
- Produces: `getTwentyClient(orgId): Promise<TwentyClient>` and `TwentyUnavailableError`. Every task
  in waves 4 and 5 consumes these. `TwentyClient` exposes
  `get<T>(path: string): Promise<T>` and `post<T>(path: string, body: unknown): Promise<T>`.

This is the tenancy boundary. It throws on every non-active state.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/crm/twenty-client.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const getTwentyConnection = vi.fn();
const resolveSecret = vi.fn();
vi.mock("../db/twenty-connections", () => ({ getTwentyConnection }));
vi.mock("../secrets/resolver", () => ({ resolveSecret }));

import { getTwentyClient, TwentyUnavailableError } from "./twenty-client";

const conn = (state: string) => ({
  orgId: "org-1", baseUrl: "https://crm-acme.example.com/", apiKeyRef: "env:K",
  coolifyServiceUuid: "svc", twentyVersion: "1.4.0", state,
});

beforeEach(() => {
  getTwentyConnection.mockReset();
  resolveSecret.mockReset().mockResolvedValue("sk-live");
});

describe("getTwentyClient", () => {
  it("throws when the org has no connection", async () => {
    getTwentyConnection.mockResolvedValue(null);
    await expect(getTwentyClient("org-1")).rejects.toThrow(TwentyUnavailableError);
  });

  it.each(["provisioning", "suspended", "deprovisioned", "failed"])(
    "throws when the connection is %s, never returning empty",
    async (state) => {
      getTwentyConnection.mockResolvedValue(conn(state));
      await expect(getTwentyClient("org-1")).rejects.toThrow(TwentyUnavailableError);
    },
  );

  it("returns a client for an active connection", async () => {
    getTwentyConnection.mockResolvedValue(conn("active"));
    await expect(getTwentyClient("org-1")).resolves.toBeDefined();
  });

  it("never puts the api key in the error message", async () => {
    getTwentyConnection.mockResolvedValue(conn("suspended"));
    await expect(getTwentyClient("org-1")).rejects.not.toThrow(/sk-live/);
  });

  it("sends a bearer token and normalises the trailing slash", async () => {
    getTwentyConnection.mockResolvedValue(conn("active"));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: 1 }) });
    vi.stubGlobal("fetch", fetchMock);

    const client = await getTwentyClient("org-1");
    await client.get("/rest/people");

    expect(fetchMock.mock.calls[0][0]).toBe("https://crm-acme.example.com/rest/people");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-live");
    vi.unstubAllGlobals();
  });

  it("throws rather than returning empty when Twenty responds with an error", async () => {
    getTwentyConnection.mockResolvedValue(conn("active"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "down" }));

    const client = await getTwentyClient("org-1");
    await expect(client.get("/rest/people")).rejects.toThrow(TwentyUnavailableError);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/crm/twenty-client.test.ts`
Expected: FAIL — `Cannot find module './twenty-client'`.

- [ ] **Step 3: Write the implementation**

```ts
// ads-agent/lib/crm/twenty-client.ts
import { getTwentyConnection } from "../db/twenty-connections";
import { resolveSecret } from "../secrets/resolver";

/**
 * Thrown whenever Twenty cannot be reached for an org, for any reason.
 *
 * Callers must let this propagate. Returning an empty list instead would make
 * "this customer has no contacts" and "this customer's CRM is unreachable"
 * indistinguishable, which is both a UX defect and the shape a tenancy leak
 * hides behind.
 */
export class TwentyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwentyUnavailableError";
  }
}

export class TwentyClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly orgId: string,
  ) {}

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      // Status, never the key, in the message.
      throw new TwentyUnavailableError(
        `Twenty request failed for org ${this.orgId}: ${res.status}`,
      );
    }
    return (await res.json()) as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body: JSON.stringify(body) });
  }
}

/**
 * The only supported way to reach Twenty. `orgId` must come from the
 * server-resolved tenant, never from a request parameter.
 */
export async function getTwentyClient(orgId: string): Promise<TwentyClient> {
  const connection = await getTwentyConnection(orgId);
  if (!connection) {
    throw new TwentyUnavailableError(`no Twenty connection provisioned for org ${orgId}`);
  }
  if (connection.state !== "active") {
    throw new TwentyUnavailableError(
      `Twenty for org ${orgId} is ${connection.state}, not active`,
    );
  }
  const apiKey = await resolveSecret(connection.apiKeyRef);
  return new TwentyClient(connection.baseUrl.replace(/\/$/, ""), apiKey, orgId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/crm/twenty-client.test.ts`
Expected: PASS, 9 tests (the `it.each` expands to four).

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/crm/twenty-client.ts ads-agent/lib/crm/twenty-client.test.ts
git commit -m "feat(crm): tenant-resolving Twenty client that throws on unavailable"
```

---

## Wave 4 — convert the three access modules (T6a, T6b, T6c in parallel)

Each takes `orgId` as its first parameter and routes through `getTwentyClient`.

### Task 6a: `twenty-pipeline.ts`

**Files:**
- Modify: `ads-agent/lib/crm/twenty-pipeline.ts` — `listOpportunities:169`, `getOpportunity:182`,
  `updateOpportunityStage:195`, `getPipelineValue:211`, `isConfigured:54`
- Modify: `ads-agent/lib/crm/twenty-pipeline.test.ts`

**Interfaces:**
- Consumes: `getTwentyClient` (T5).
- Produces: `listOpportunities(orgId)`, `getOpportunity(orgId, id)`,
  `updateOpportunityStage(orgId, id, stage)`, `getPipelineValue(orgId)`. Tasks 7a, 7b, 7c and 7e
  consume these signatures.

- [ ] **Step 1: Write the failing test**

```ts
// append to ads-agent/lib/crm/twenty-pipeline.test.ts
import { TwentyUnavailableError } from "./twenty-client";

it("propagates unavailability instead of returning an empty list", async () => {
  vi.mocked(getTwentyClient).mockRejectedValue(new TwentyUnavailableError("suspended"));
  await expect(listOpportunities("org-1")).rejects.toThrow(TwentyUnavailableError);
});

it("sends the request to the resolved org's client", async () => {
  const get = vi.fn().mockResolvedValue({ data: { opportunities: [] } });
  vi.mocked(getTwentyClient).mockResolvedValue({ get, post: vi.fn(), orgId: "org-1" } as never);
  await listOpportunities("org-1");
  expect(getTwentyClient).toHaveBeenCalledWith("org-1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/crm/twenty-pipeline.test.ts`
Expected: FAIL — `listOpportunities` currently takes no `orgId` and fails soft to `[]`.

- [ ] **Step 3: Convert each exported function**

Replace the module-level MCP calls with the client. `isConfigured()` is **deleted** — configuration is
now per-org and answered by `getTwentyClient` throwing.

```ts
import { getTwentyClient } from "./twenty-client";

export async function listOpportunities(orgId: string): Promise<Opportunity[]> {
  const client = await getTwentyClient(orgId);
  const raw = await client.get<unknown>("/rest/opportunities?limit=200");
  return extractRawOpportunities(raw).map(toOpportunity);
}

export async function getOpportunity(orgId: string, id: string): Promise<Opportunity | null> {
  const client = await getTwentyClient(orgId);
  const raw = await client.get<unknown>(`/rest/opportunities/${encodeURIComponent(id)}`);
  const [first] = extractRawOpportunities(raw);
  return first ? toOpportunity(first) : null;
}

export async function updateOpportunityStage(
  orgId: string,
  id: string,
  stage: PipelineStageValue,
): Promise<void> {
  const client = await getTwentyClient(orgId);
  await client.post(`/rest/opportunities/${encodeURIComponent(id)}`, { stage });
}

export async function getPipelineValue(orgId: string): Promise<number> {
  const opportunities = await listOpportunities(orgId);
  return opportunities.reduce((total, o) => total + (o.amountInr ?? 0), 0);
}
```

Leave the pure helpers (`maskPhone`, `toAmountInr`, `toContact`, `toOpportunity`,
`formatAmountLabelInr`, `toOpenUiOpportunityCard`, `isRawOpportunity`, `extractRawOpportunities`,
`reshapeTwentyOpportunityToolResult`) untouched — they take no connection and need no `orgId`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/crm/twenty-pipeline.test.ts`
Expected: PASS. Type errors in consumers are expected until wave 5 and must not be fixed here.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/crm/twenty-pipeline.ts ads-agent/lib/crm/twenty-pipeline.test.ts
git commit -m "refactor(crm): twenty-pipeline takes orgId and propagates unavailability"
```

### Task 6b: `connectors/twenty.ts`

**Files:**
- Modify: `ads-agent/lib/connectors/twenty.ts` — `baseUrl:5` (delete), `fetchLeadSignal:23`
- Test: `ads-agent/lib/connectors/twenty.test.ts`

**Interfaces:**
- Consumes: `getTwentyClient` (T5).
- Produces: `fetchLeadSignal(orgId: string): Promise<LeadSignal>`. Tasks 7b and 7d consume it.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/connectors/twenty.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
const getTwentyClient = vi.fn();
vi.mock("../crm/twenty-client", () => ({
  getTwentyClient,
  TwentyUnavailableError: class extends Error {},
}));
import { fetchLeadSignal } from "./twenty";

beforeEach(() => getTwentyClient.mockReset());

it("counts tiers from the org's own instance", async () => {
  getTwentyClient.mockResolvedValue({
    get: async () => ({ data: { opportunities: [{ tier: "hot" }, { tier: "warm" }, {}] } }),
  });
  await expect(fetchLeadSignal("org-1")).resolves.toEqual({
    hotCount: 1, warmCount: 1, coldCount: 0, unscoredCount: 1,
  });
});

it("propagates unavailability rather than reporting zero leads", async () => {
  getTwentyClient.mockRejectedValue(new Error("suspended"));
  await expect(fetchLeadSignal("org-1")).rejects.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/connectors/twenty.test.ts`
Expected: FAIL — `fetchLeadSignal` takes no argument and returns `EMPTY_SIGNAL` on failure.

- [ ] **Step 3: Write the implementation**

Delete `baseUrl()` and `EMPTY_SIGNAL`; the empty signal was the fail-soft path this removes.

```ts
import { getTwentyClient } from "../crm/twenty-client";

export async function fetchLeadSignal(orgId: string): Promise<LeadSignal> {
  const client = await getTwentyClient(orgId);
  const json = await client.get<unknown>("/rest/opportunities?limit=200");
  const opportunities = extractOpportunities(json);

  return opportunities.reduce<LeadSignal>(
    (acc, o) => {
      if (o.tier === "hot") acc.hotCount += 1;
      else if (o.tier === "warm") acc.warmCount += 1;
      else if (o.tier === "cold") acc.coldCount += 1;
      else acc.unscoredCount += 1;
      return acc;
    },
    { hotCount: 0, warmCount: 0, coldCount: 0, unscoredCount: 0 },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/connectors/twenty.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/connectors/twenty.ts ads-agent/lib/connectors/twenty.test.ts
git commit -m "refactor(connectors): fetchLeadSignal resolves the org's Twenty"
```

### Task 6c: `lib/crm/twenty.ts` (marketing site)

**Files:**
- Modify: `lib/crm/twenty.ts` — `baseUrl:14` (delete), `isTwentyConfigured:18` (delete),
  `twentyPost:55`, `createLeadInTwenty:89`
- Modify: `lib/crm/twenty.test.ts`

**Interfaces:**
- Consumes: `getTwentyClient` (T5).
- Produces: `createLeadInTwenty(orgId: string, payload: LeadPayload, qualification?: LeadQualification): Promise<TwentyCreateLeadResult>`.
  Task 7g consumes it.

Gentle Space is a tenant like any other (TW7), so its own site passes its `org_id`.

- [ ] **Step 1: Write the failing test**

```ts
// append to lib/crm/twenty.test.ts
it("requires an orgId and routes to that org's instance", async () => {
  getTwentyClient.mockResolvedValue({ post: vi.fn().mockResolvedValue({ data: { id: "p-1" } }) });
  await createLeadInTwenty("org-gentlespace", payload);
  expect(getTwentyClient).toHaveBeenCalledWith("org-gentlespace");
});

it("reports failure rather than throwing, so the public form still submits", async () => {
  getTwentyClient.mockRejectedValue(new Error("suspended"));
  await expect(createLeadInTwenty("org-gentlespace", payload))
    .resolves.toMatchObject({ status: "failed" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/crm/twenty.test.ts`
Expected: FAIL — `createLeadInTwenty` takes no `orgId`.

- [ ] **Step 3: Write the implementation**

Delete `baseUrl()` and `isTwentyConfigured()`. This is the one call site that deliberately keeps
failing soft: the public marketing form must still submit when Twenty is down, and the enquiry is
captured regardless.

```ts
import { getTwentyClient } from "@/ads-agent/lib/crm/twenty-client";

export async function createLeadInTwenty(
  orgId: string,
  payload: LeadPayload,
  qualification?: LeadQualification,
): Promise<TwentyCreateLeadResult> {
  try {
    const client = await getTwentyClient(orgId);
    const { firstName, lastName } = splitName(payload.name);
    const person = await client.post<unknown>("/rest/people", {
      name: { firstName, lastName },
      phones: { primaryPhoneNumber: digitsPhone(payload.phone) },
      emails: payload.email ? { primaryEmail: payload.email } : undefined,
    });
    const personId = extractId(person);

    const opportunity = await client.post<unknown>("/rest/opportunities", {
      name: payload.name,
      pointOfContactId: personId,
      ...(qualification ? { tier: toTwentySelect(qualification.tier) } : {}),
    });

    return { status: "created", personId, opportunityId: extractId(opportunity) };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "unknown" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/crm/twenty.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/crm/twenty.ts lib/crm/twenty.test.ts
git commit -m "refactor(crm): createLeadInTwenty routes to the org's instance"
```

---

## Wave 5 — convert the call sites (T7a–T7g, seven agents in parallel)

Every task here is independent: a different file, a different test, no shared edits.

| Task | File | Symbols to update |
|---|---|---|
| T7a | `ads-agent/app/(admin)/crm/page.tsx` | `listOpportunities` |
| T7b | `ads-agent/app/(admin)/page.tsx` | `getPipelineValue`, `fetchLeadSignal` |
| T7c | `ads-agent/app/api/crm/opportunities/[id]/stage/route.ts` | `updateOpportunityStage` |
| T7d | `ads-agent/lib/decision-engine/cycle.ts` | `fetchLeadSignal` |
| T7e | `ads-agent/lib/openui/crm-tools.ts` | `listOpportunities`, `getOpportunity`, `updateOpportunityStage` |
| T7f | `ads-agent/lib/openui/resolve-tools-then-generate.ts` + `opportunity-openui-lang.ts` | `TWENTY_MCP_READ_TOOL_NAMES`, `TWENTY_MCP_TOOLS` |
| T7g | `app/api/leads/route.ts` | `createLeadInTwenty` |

**Common recipe — every task follows these five steps.**

- [ ] **Step 1: Write the failing test** — assert two things: the call passes the server-resolved
  `orgId`, and a `TwentyUnavailableError` surfaces as an error state rather than as empty content.

```ts
it("passes the resolved tenant, not a request parameter", async () => {
  await handler(requestForOrg("org-1"));
  expect(listOpportunities).toHaveBeenCalledWith("org-1");
});

it("renders an error state when Twenty is unavailable", async () => {
  vi.mocked(listOpportunities).mockRejectedValue(new TwentyUnavailableError("suspended"));
  const result = await handler(requestForOrg("org-1"));
  expect(result).toMatchObject({ error: expect.stringContaining("unavailable") });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run <the file's test path>`
Expected: FAIL — the call currently passes no `orgId`.

- [ ] **Step 3: Thread the tenant through**

Server components and route handlers obtain `orgId` from the session helper established in S3 —
never from a query string, path segment or body.

Two tasks differ and must not follow the recipe blindly:

**T7d** — `cycle.ts` runs headless with no session. It iterates orgs explicitly and calls
`fetchLeadSignal(org.id)` inside its existing loop. A `TwentyUnavailableError` for one org is caught,
logged, and skipped, so one suspended tenant cannot halt the cycle for every other tenant.

**T7f** — delete both `TWENTY_MCP_*` imports outright. The generative surface reaches Twenty through
the converted `crm-tools.ts` from T7e, not through the sidecar. There is no replacement import.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run <the file's test path>`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add <the file> <its test>
git commit -m "refactor(<area>): resolve Twenty per tenant"
```

---

## Task 8: Cross-tenant test suite

**Files:**
- Create: `ads-agent/lib/crm/twenty-tenancy.test.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/crm/twenty-tenancy.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { getTwentyClient, TwentyUnavailableError } from "./twenty-client";

const getTwentyConnection = vi.fn();
vi.mock("../db/twenty-connections", () => ({ getTwentyConnection }));
vi.mock("../secrets/resolver", () => ({ resolveSecret: async () => "sk-live" }));

beforeEach(() => getTwentyConnection.mockReset());

describe("tenant isolation", () => {
  it("sends each org's request to its own base url", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    getTwentyConnection.mockResolvedValue({
      orgId: "org-a", baseUrl: "https://crm-a.example.com", apiKeyRef: "env:K",
      coolifyServiceUuid: "s", twentyVersion: "1.4.0", state: "active",
    });
    await (await getTwentyClient("org-a")).get("/rest/people");

    getTwentyConnection.mockResolvedValue({
      orgId: "org-b", baseUrl: "https://crm-b.example.com", apiKeyRef: "env:K",
      coolifyServiceUuid: "s", twentyVersion: "1.4.0", state: "active",
    });
    await (await getTwentyClient("org-b")).get("/rest/people");

    expect(fetchMock.mock.calls[0][0]).toContain("crm-a.example.com");
    expect(fetchMock.mock.calls[1][0]).toContain("crm-b.example.com");
    vi.unstubAllGlobals();
  });

  it("cannot be constructed without going through the registry", async () => {
    getTwentyConnection.mockResolvedValue(null);
    await expect(getTwentyClient("org-unknown")).rejects.toThrow(TwentyUnavailableError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/crm/twenty-tenancy.test.ts`
Expected: FAIL until every wave-5 task has landed.

- [ ] **Step 3: Add the regression guard against singleton config**

This walks the source tree with `fs` — no shell, no `child_process`, so there is no command-injection
surface in the test suite itself.

```ts
// append to ads-agent/lib/crm/twenty-tenancy.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BANNED = ["TWENTY_BASE_URL", "TWENTY_API_KEY", "TWENTY_MCP_URL"];

function offendersUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      offendersUnder(full, found);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    // This file names the banned strings in order to ban them.
    if (full.endsWith("twenty-tenancy.test.ts")) continue;
    const source = readFileSync(full, "utf-8");
    if (BANNED.some((name) => source.includes(name))) found.push(full);
  }
  return found;
}

it("has no direct Twenty connection config left in source", () => {
  expect(offendersUnder(join(process.cwd(), "lib"))).toEqual([]);
  expect(offendersUnder(join(process.cwd(), "app"))).toEqual([]);
});
```

- [ ] **Step 4: Run the whole suite**

Run: `cd ads-agent && npx vitest run`
Expected: PASS, all files.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/crm/twenty-tenancy.test.ts
git commit -m "test(crm): cross-tenant isolation and no-singleton-config guard"
```

---

## Task 9: Delete the sidecar and document provisioning

**Files:**
- Delete: `ads-agent/lib/bifrost/twenty-mcp-tools.ts`
- Modify: `ads-agent/lib/bifrost/mcp-client.ts` — remove `listTwentyTools:67`, `callTwentyTool:79`
- Modify: `docker-compose.yml` — remove the `twenty-mcp-gateway` service
- Create: `docs/runbooks/provision-twenty-instance.md`

- [ ] **Step 1: Verify nothing still imports the sidecar**

Run: `git grep -n "twenty-mcp-tools" -- '*.ts' '*.tsx'`
Expected: no output. If there is output, the referencing wave-5 task is incomplete — stop and finish
it first.

- [ ] **Step 2: Delete the module and its compose service**

```bash
git rm ads-agent/lib/bifrost/twenty-mcp-tools.ts
```

Remove `listTwentyTools` and `callTwentyTool` from `mcp-client.ts`, and delete the
`twenty-mcp-gateway` service block from `docker-compose.yml`.

- [ ] **Step 3: Run the full suite and build**

Run: `cd ads-agent && npx vitest run && npm run build`
Expected: PASS and a clean build. Task 8's guard now passes, since the last `TWENTY_MCP_URL` reference
is gone.

- [ ] **Step 4: Write the provisioning runbook**

Create `docs/runbooks/provision-twenty-instance.md`:

```markdown
# Provisioning a Twenty instance for a new org

Steps 1–4 and 6 are scripted against the Coolify API; step 5 is manual because
Twenty exposes no endpoint for API-key creation.

1. `service create` with the Twenty compose definition via `docker_compose_raw`.
   Record the returned uuid as `coolify_service_uuid`.
2. `env_vars` — set `SERVER_URL`, `PG_DATABASE_URL` (a database on the shared
   Postgres server), `REDIS_URL`, and `APP_SECRET`. Leave
   `IS_MULTIWORKSPACE_ENABLED` unset: each instance runs default
   single-workspace mode, which is the best-tested path.
3. `update_application` — assign the tenant FQDN.
4. `deploy`, then poll until healthy.
5. **Manual:** open the instance, complete first-run setup, then
   Settings → API & Webhooks → Create key. Scope the key to a role with person
   and opportunity access only — never workspace admin.
6. Store the key in the secret store, insert the `context.twenty_connections`
   row with `state = 'active'`, and record `twenty_version`.

Deprovisioning is `service delete` with `delete_volumes: true`, which destroys
the org's entire CRM footprint in one call. Record it in
`context.deletion_propagations` with `store = 'twenty'`.

Suspending an inactive org is `control` stop; set `state = 'suspended'` so
`getTwentyClient` throws a clear reason rather than a connection timeout.

Sizing: 2GB RAM minimum per instance, linear in customers.
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(bifrost): delete the Twenty MCP sidecar; add provisioning runbook"
```

---

## Self-review

**Spec coverage.** TW1 → Task 9 runbook. TW2/TW3 → Tasks 1 and 4 (the cache is overwritten by sync,
never edited in place). TW4 → deferred to S5a, stated in Preconditions; no task builds a synchronous
projection. TW5 → Task 4's merge resolution and Task 1's `merged_into`. TW6 → Task 9. TW7 → Task 6c
passes Gentle Space's own `org_id`. TW8 → no migration task exists, by design.

**Deliberately not covered**, because the outbox (S5a) does not exist yet: the enquiry → Twenty
projection worker and the write-back of `twenty_person_id`. Building them now would mean building
against an event backbone that has not been written. `adsagent.contacts` ships with `sync_state`
defaulting to `pending`, the correct resting state until that worker exists.

**Type consistency.** `getTwentyClient(orgId)` returns `TwentyClient` with `get`/`post` in Tasks 5,
6a, 6b, 6c and 8. `TwentyUnavailableError` is thrown in Task 5 and asserted in 6a, 6b, 7a–g and 8.
`TwentyConnection` fields are camelCase in Task 3 and consumed as camelCase in Task 5. `Contact` and
`ContactSyncState` appear only in Task 4. `LeadSignal` keeps its existing four-count shape in Task 6b.

**Placeholder scan.** No TBD, no "handle edge cases", no "similar to Task N". Every code step carries
complete code. Wave 5's shared recipe states its two exceptions (T7d, T7f) explicitly rather than
leaving the implementer to infer them.

**One deliberate inconsistency.** Task 6c keeps failing soft while every other call site now throws.
That is not an oversight: the public marketing form must still submit when Twenty is unavailable,
because losing an enquiry is worse than losing its CRM projection. Task 6c's second test pins that
behaviour so a later reviewer does not "fix" it.
