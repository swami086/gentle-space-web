# S15 Inbound Expansion (Email + WhatsApp) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Parallelism:** One git worktree + branch per implementation subagent (`superpowers:using-git-worktrees` / `best-of-n-runner`). Ceiling: **8 concurrent implementation subagents**. Never share a working tree across parallel writers. Prefer Torbit (`repo_path` `/Users/swami/Documents/GentleSpace_Web`, branch `main`) — **re-index before querying** if HEAD drifts past the commit that wrote this plan. Minimize grep.
>
> **This plan is organized into execution waves.** Within a wave, tasks touch **disjoint files** and have no unfinished interface dependency on each other — dispatch every task in a wave in the same batch. Do not start a dependent wave until every listed dependency has passed review.

**Goal:** Land inbound Postmark email and Meta WhatsApp Cloud messages onto `adsagent.enquiry_messages` (with Garage media) via fast-ack webhooks + an outbox-backed worker, platform-org only, with no outbound send path (BD2).

**Architecture:** Webhooks verify provider auth, insert `adsagent.inbound_events` + enqueue `inbound.message_received` in one tenant transaction, return `200`. A dedicated worker claims `pending` inbound events (`FOR UPDATE SKIP LOCKED`), matches or creates enquiry/contact, downloads media into `putArtifact(inbound_media)`, then `addMessage` + `refreshEnquirySignals`. Middleware already excludes `/api/*` from session redirect — no matcher change required.

**Tech Stack:** Next.js 15 App Router (ads-agent), TypeScript, Vitest, Postgres (`adsagent` / `context`), Garage ObjectStore (`putArtifact`), Node `crypto` (HMAC / token mint — no new npm deps), existing outbox (`enqueueEvent`).

**Spec (authoritative):** [`docs/superpowers/specs/2026-08-13-s15-inbound-expansion-design.md`](../specs/2026-08-13-s15-inbound-expansion-design.md)

**Torbit hubs (GentleSpace_Web `main`):**

| Area | Paths |
|---|---|
| Messages / signals | `ads-agent/lib/db/enquiry-messages.ts`, `enquiry-signals.ts` (`refreshEnquirySignals`) |
| Contacts / enquiries | `ads-agent/lib/db/contacts.ts` (`createContact`), `enquiries.ts` (`createEnquiry`, `REPLY_STATES`) |
| Outbox | `ads-agent/lib/db/outbox.ts` (`enqueueEvent`), `lib/events/topics.ts` (`OUTBOX_TOPICS`), `lib/events/topics.db.test.ts` |
| Artifacts | `ads-agent/lib/artifacts/{key,store}.ts` — DB CHECK in `080_context_artifacts.up.sql` |
| Middleware | `ads-agent/middleware.ts` — `matcher` already skips `api` |
| Worker pattern | `ads-agent/scripts/run-proposal-undo-worker.ts` |
| Latest migration | `111_generative_answers` → next **`112`** |

## Decisions locked in this plan

| ID | Decision |
|---|---|
| **S15-D1** | B2 + B3 in one ship; unmatched → create contact + enquiry. |
| **S15-D2** | Org = `{ kind: "org", orgId: PLATFORM_ORG_ID }` only. |
| **S15-D3** | Postmark inbound + Meta Cloud webhooks. |
| **S15-D4** | Full media → Garage `inbound_media` (extend TS + DB CHECK). |
| **S15-D5** | Fast-ack + worker claims `inbound_events` (outbox still written for vocabulary/relay). |
| **S15-D6** | Token = `crypto.randomBytes(16).toString("hex")` (no `nanoid`). |
| **S15-D7** | No new npm dependencies. No outbound send routes/libraries. |
| **S15-D8** | Commits only when the user explicitly asks during execution — per-task commit steps are the intended message/files when authorized. |
| **S15-D9** | Media size cap **25_000_000** bytes; oversize → body `[media skipped: too large]`, no artifact. |
| **S15-D10** | Worker waits for media artifacts before `addMessage` when media is present. |

## Global Constraints

- Test: `cd ads-agent && npx vitest run <path>` (or `npm test -- <path>` if scripted). Prefer unit tests with mocked `pg`/`tx` like `enquiry-messages.test.ts`.
- `orgIdForWrite` requires `scope.kind === "org"` — never use platform scope for writes.
- Prefer Torbit SQL over grep. Symlink `node_modules` → main checkout in worktrees.
- Soft-fail provider retries via UNIQUE `(org_id, channel, external_id)`.
- BD2: do not add WhatsApp send or email send clients.

## Skills catalog shortlist (use these — do not invent others)

| Skill path | Role |
|---|---|
| `superpowers:using-git-worktrees` | **Required** for every parallel implementation agent |
| `superpowers:test-driven-development` | **Required** for every code task |
| `superpowers:subagent-driven-development` | Orchestrator / SDD runner |
| `superpowers:dispatching-parallel-agents` | Wave fan-out |
| `superpowers:requesting-code-review` | Spec + quality review after each task |
| `superpowers:verification-before-completion` | Final gate |
| `superpowers:systematic-debugging` | Only if stuck |
| `superpowers:finishing-a-development-branch` | Merge / cleanup after gate |
| `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md` | Webhooks, worker, DB modules |
| `~/.cursor/skills/engineering-skills/senior-security/SKILL.md` | HMAC / Basic Auth / raw-body verify |
| `~/.cursor/skills/engineering-skills/tdd-guide/SKILL.md` | Alternate TDD playbook |
| `~/.cursor/skills/engineering-skills/senior-qa/SKILL.md` | Gate + regression |
| `~/.cursor/skills/engineering-skills/code-reviewer/SKILL.md` | Post-merge review |
| `~/.cursor/skills/engineering-skills/adversarial-reviewer/SKILL.md` | Final gate review |
| `~/.cursor/skills/engineering-skills/senior-devops/SKILL.md` | Worker script / env / runbook (T14) |
| `~/.cursor/skills/engineering-skills/ai-security/SKILL.md` | Confirm `is_untrusted` preserved (T13/T14) |

Process skills apply to **every** task. Domain skills listed per task below.

**engineering-skills2 route for this plan:** `senior-backend` — primary work is webhook/worker/data path; security + QA support verify helpers and gate.

## File map

| Path | Responsibility | Wave owner |
|---|---|---|
| `ads-agent/lib/db/migrations/112_inbound_expansion.{up,down}.sql` | Schema: events, reply_token, outbox topic, artifact CHECK | T1 |
| `ads-agent/lib/events/topics.ts` + `topics.db.test.ts` | Add `inbound.message_received` | T1 |
| `ads-agent/lib/artifacts/key.ts` + `key.test.ts` | `inbound_media` content type | T2 |
| `ads-agent/lib/inbound/whatsapp-verify.ts` + test | Hub challenge + X-Hub-Signature-256 | T3 |
| `ads-agent/lib/inbound/postmark-auth.ts` + test | Basic Auth | T4 |
| `ads-agent/lib/inbound/phone.ts` + test | E.164 normalize | T5 |
| `ads-agent/lib/db/contacts.ts` (+ test) | `findContactByPhone` | T6 |
| `ads-agent/lib/db/enquiries.ts` (+ test) | mint token + `findEnquiryByReplyToken` + open-by-phone | T7 |
| `ads-agent/lib/db/inbound-events.ts` (+ test) | insert / claim / mark | T8 |
| `ads-agent/lib/inbound/match.ts` (+ test) | Match or create enquiry | T9 |
| `ads-agent/lib/inbound/media.ts` (+ test) | Download + `putArtifact` | T10 |
| `ads-agent/app/api/inbound/whatsapp/route.ts` (+ test) | GET/POST WA | T11 |
| `ads-agent/app/api/inbound/email/route.ts` (+ test) | POST Postmark | T12 |
| `ads-agent/lib/inbound/process.ts` (+ test) | Worker core | T13 |
| `ads-agent/scripts/run-inbound-worker.ts`, `package.json`, `.env.example`, runbook, gate, spec status | Ops + gate | T14 |

## Parallel execution waves

| Wave | Tasks (parallel) | Depends on | Width |
|---|---|---|---|
| **W1** | T1–T8 | — | **8** |
| **W2** | T9–T12 | T1+T3+T4+T5+T6+T7+T8 (T2 needed before T10 media content type) | **4** |
| **W3** | T13–T14 | T9–T12, T2 | **2** |

Peak parallel width: **8** (W1). Merge W1 before starting W2. Merge W2 before W3.

| Task | Recommended model | Domain skills |
|---|---|---|
| 1 | `inherit` | senior-backend + TDD |
| 2 | `composer-2.5-fast` | senior-backend + TDD |
| 3, 4 | `inherit` | senior-security + TDD |
| 5, 6, 7, 8 | `composer-2.5-fast` | senior-backend + TDD |
| 9, 10, 13 | `inherit` | senior-backend + TDD (+ ai-security on T13) |
| 11, 12 | `inherit` | senior-backend + senior-security + TDD |
| 14 | `inherit` | senior-qa + senior-devops + code-reviewer + adversarial-reviewer + verification-before-completion |

**Shared interface constants (all tasks):**

```ts
// Platform scope helper — each module may inline or import from lib/inbound/platform-scope.ts (T8 may create; others may duplicate one-liner until merge)
export function platformOrgScope(env: NodeJS.ProcessEnv = process.env): { kind: "org"; orgId: string } {
  const orgId = env.PLATFORM_ORG_ID?.trim();
  if (!orgId) throw new Error("PLATFORM_ORG_ID is not set");
  return { kind: "org", orgId };
}

export const INBOUND_MEDIA_MAX_BYTES = 25_000_000;
export const INBOUND_OUTBOX_TOPIC = "inbound.message_received" as const;
```

---

### Task 1: Migration 112 + outbox topic vocabulary

**Files:**
- Create: `ads-agent/lib/db/migrations/112_inbound_expansion.up.sql`
- Create: `ads-agent/lib/db/migrations/112_inbound_expansion.down.sql`
- Modify: `ads-agent/lib/events/topics.ts`
- Test: `ads-agent/lib/events/topics.db.test.ts` (existing — must stay green after topic add)

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md`

**Interfaces:**
- Consumes: `OUTBOX_TOPICS` pattern; `080` artifact CHECK; `022` enquiry_messages
- Produces: schema for T8/T7/T2 DB; topic `inbound.message_received`

- [ ] **Step 1: Extend `OUTBOX_TOPICS` (failing db test until migration applied)**

In `ads-agent/lib/events/topics.ts`, append `"inbound.message_received"` to the array (keep alphabetical-or-existing order: append at end).

- [ ] **Step 2: Write `112_inbound_expansion.up.sql`**

```sql
BEGIN;

-- Reply token on enquiries
ALTER TABLE adsagent.enquiries
  ADD COLUMN IF NOT EXISTS inbound_reply_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS enquiries_org_inbound_reply_token_uidx
  ON adsagent.enquiries (org_id, inbound_reply_token)
  WHERE inbound_reply_token IS NOT NULL;

-- Durable webhook intake
CREATE TABLE adsagent.inbound_events (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        public.org_ref NOT NULL REFERENCES public.orgs(id),
  channel       TEXT NOT NULL CHECK (channel IN ('email','whatsapp')),
  external_id   TEXT NOT NULL,
  payload       JSONB NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processed','failed')),
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  CONSTRAINT inbound_events_external_unique UNIQUE (org_id, channel, external_id)
);

CREATE INDEX inbound_events_pending_idx
  ON adsagent.inbound_events (created_at)
  WHERE status = 'pending';

ALTER TABLE adsagent.inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.inbound_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.inbound_events
  USING (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- Outbox topic vocabulary (must match OUTBOX_TOPICS)
ALTER TABLE context.outbox_events DROP CONSTRAINT IF EXISTS outbox_events_topic_check;
ALTER TABLE context.outbox_events
  ADD CONSTRAINT outbox_events_topic_check CHECK (topic IN (
    'enquiry.received','enquiry.activity_logged','graph.tenant_stale',
    'agent.task_requested','reminder.due','deletion.requested',
    'portal.event','inbound.message_received'));

-- Artifact content type
ALTER TABLE context.artifacts DROP CONSTRAINT IF EXISTS artifacts_content_type_check;
ALTER TABLE context.artifacts
  ADD CONSTRAINT artifacts_content_type_check CHECK (content_type IN
    ('talking_points','draft','context_pack','trace_payload','call_recording','inbound_media'));

COMMIT;
```

- [ ] **Step 3: Write matching `.down.sql`** that restores previous CHECKs (copy exact lists from `040` / `080`), drops `inbound_events`, drops index + column `inbound_reply_token`.

- [ ] **Step 4: Apply + verify topics test**

```bash
cd ads-agent && npm run migrate && npx vitest run lib/events/topics.db.test.ts
```

Expected: PASS (TS list === DB CHECK).

- [ ] **Step 5: Commit** (when authorized)

```bash
git add ads-agent/lib/db/migrations/112_inbound_expansion.up.sql \
  ads-agent/lib/db/migrations/112_inbound_expansion.down.sql \
  ads-agent/lib/events/topics.ts
git commit -m "feat(s15): inbound_events schema and outbox topic"
```

---

### Task 2: Artifact content type `inbound_media`

**Files:**
- Modify: `ads-agent/lib/artifacts/key.ts`
- Modify: `ads-agent/lib/artifacts/key.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md`

**Interfaces:**
- Consumes: existing `ARTIFACT_CONTENT_TYPES`
- Produces: `"inbound_media"` in the union (DB CHECK from T1)

- [ ] **Step 1: Failing test** — update the “exactly five content types” test to expect six including `inbound_media`:

```ts
expect([...ARTIFACT_CONTENT_TYPES]).toEqual([
  "talking_points",
  "draft",
  "context_pack",
  "trace_payload",
  "call_recording",
  "inbound_media",
]);
```

- [ ] **Step 2: Run** `npx vitest run lib/artifacts/key.test.ts` — expect FAIL.

- [ ] **Step 3: Append `"inbound_media"` to `ARTIFACT_CONTENT_TYPES` in `key.ts`.**

- [ ] **Step 4: Run tests — PASS.**

- [ ] **Step 5: Commit** (when authorized) — `feat(s15): add inbound_media artifact content type`

---

### Task 3: WhatsApp webhook verify helpers

**Files:**
- Create: `ads-agent/lib/inbound/whatsapp-verify.ts`
- Create: `ads-agent/lib/inbound/whatsapp-verify.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-security/SKILL.md`

**Interfaces:**
- Produces:
  - `verifyWhatsAppHubChallenge(params: URLSearchParams, verifyToken: string): string | null`
  - `verifyWhatsAppSignature(rawBody: string | Buffer, signatureHeader: string | null, appSecret: string): boolean`

- [ ] **Step 1: Write failing tests**

```ts
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWhatsAppHubChallenge, verifyWhatsAppSignature } from "./whatsapp-verify";

describe("verifyWhatsAppHubChallenge", () => {
  it("returns hub.challenge when verify_token matches", () => {
    const params = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "tok",
      "hub.challenge": "12345",
    });
    expect(verifyWhatsAppHubChallenge(params, "tok")).toBe("12345");
  });
  it("returns null on token mismatch", () => {
    const params = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "bad",
      "hub.challenge": "12345",
    });
    expect(verifyWhatsAppHubChallenge(params, "tok")).toBeNull();
  });
});

describe("verifyWhatsAppSignature", () => {
  it("accepts valid sha256 HMAC", () => {
    const body = '{"a":1}';
    const sig = createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyWhatsAppSignature(body, `sha256=${sig}`, "secret")).toBe(true);
  });
  it("rejects missing/invalid signatures", () => {
    expect(verifyWhatsAppSignature("{}", null, "secret")).toBe(false);
    expect(verifyWhatsAppSignature("{}", "sha256=dead", "secret")).toBe(false);
  });
});
```

- [ ] **Step 2: Run — FAIL.** Step 3: implement with `timingSafeEqual` on hex digests (pad/length-check before compare). Step 4: PASS. Step 5: Commit `feat(s15): WhatsApp webhook signature helpers`.

---

### Task 4: Postmark Basic Auth helper

**Files:**
- Create: `ads-agent/lib/inbound/postmark-auth.ts`
- Create: `ads-agent/lib/inbound/postmark-auth.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-security/SKILL.md`

**Interfaces:**
- Produces: `verifyPostmarkBasicAuth(authorizationHeader: string | null, user: string, pass: string): boolean`

- [ ] **Step 1: Failing tests** — accept `Basic base64(user:pass)`; reject missing/wrong; use `timingSafeEqual` on decoded credentials.

- [ ] **Step 2–4: Implement + pass.** Step 5: Commit `feat(s15): Postmark inbound Basic Auth helper`.

---

### Task 5: E.164 phone normalize

**Files:**
- Create: `ads-agent/lib/inbound/phone.ts`
- Create: `ads-agent/lib/inbound/phone.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md`

**Interfaces:**
- Produces: `normalizeToE164(raw: string, defaultCountry?: "IN"): string | null`
  - Strip non-digits except leading `+`
  - If 10 digits and `defaultCountry === "IN"`, prefix `+91`
  - If already starts with `+` and length ≥ 10, keep
  - Else null

- [ ] **Step 1: Tests** for `9876543210` → `+919876543210`, `+919876543210` unchanged, garbage → null.

- [ ] **Step 2–4: Implement + pass.** Step 5: Commit `feat(s15): E.164 phone normalize for WA match`.

---

### Task 6: `findContactByPhone`

**Files:**
- Modify: `ads-agent/lib/db/contacts.ts`
- Modify: `ads-agent/lib/db/contacts.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md`

**Interfaces:**
- Consumes: `Scope`, `COLUMNS`, `rowToContact`
- Produces: `findContactByPhone(scope: Scope, phone: string): Promise<Contact | null>`

- [ ] **Step 1: Failing unit test** (mock `withTenantTransaction` like existing contacts tests):

```ts
it("findContactByPhone selects by org + phone", async () => {
  query.mockResolvedValue({ rows: [row] });
  const c = await findContactByPhone(scope, "+919800000000");
  expect(c?.phone).toBe("+919800000000");
  const [sql, params] = query.mock.calls[0];
  expect(sql).toMatch(/FROM adsagent\.contacts/i);
  expect(params).toEqual(["org-1", "+919800000000"]);
});
```

- [ ] **Step 2: Implement**

```ts
export async function findContactByPhone(scope: Scope, phone: string): Promise<Contact | null> {
  const clause = scopeClause(scope);
  const n = clause.params.length;
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ContactRow>(
      `SELECT ${COLUMNS} FROM adsagent.contacts
        WHERE ${clause.sql} AND phone = $${n + 1}
        LIMIT 1`,
      [...clause.params, phone],
    );
    return rows[0] ? rowToContact(rows[0]) : null;
  });
}
```

- [ ] **Step 3–4: PASS.** Step 5: Commit `feat(s15): findContactByPhone`.

---

### Task 7: Enquiry reply token + lookups

**Files:**
- Modify: `ads-agent/lib/db/enquiries.ts`
- Modify: `ads-agent/lib/db/enquiries.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md`

**Interfaces:**
- Produces:
  - `mintInboundReplyToken(): string` — `randomBytes(16).toString("hex")`
  - `Enquiry.inboundReplyToken: string | null` on type + row mapping
  - `createEnquiry` INSERT includes `inbound_reply_token` always minted
  - `findEnquiryByReplyToken(scope, token): Promise<Enquiry | null>`
  - `findOpenEnquiryForContact(scope, contactId): Promise<Enquiry | null>` — newest `lifecycle='active' AND reply_state <> 'closed'`

- [ ] **Step 1: Extend row fixture + failing tests** for INSERT param including token; findByReplyToken SQL; findOpenEnquiryForContact orders by `last_activity_at DESC`.

- [ ] **Step 2: Update `COLUMNS` / `EnquiryRow` / `rowToEnquiry` / `createEnquiry` SQL** to include `inbound_reply_token`.

```ts
import { randomBytes } from "node:crypto";
export function mintInboundReplyToken(): string {
  return randomBytes(16).toString("hex");
}
// createEnquiry params push mintInboundReplyToken() as last/new column
```

- [ ] **Step 3–4: PASS.** Step 5: Commit `feat(s15): enquiry inbound_reply_token + lookups`.

---

### Task 8: `inbound-events` DB module + platform scope helper

**Files:**
- Create: `ads-agent/lib/inbound/platform-scope.ts`
- Create: `ads-agent/lib/db/inbound-events.ts`
- Create: `ads-agent/lib/db/inbound-events.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md`

**Interfaces:**
- Produces:
  - `platformOrgScope(env?): Scope` (org kind)
  - `insertInboundEvent(scope, client, { channel, externalId, payload }): Promise<{ id: string; inserted: boolean }>`
  - `claimPendingInboundEvents(limit: number): Promise<InboundEvent[]>` — platform pool, `FOR UPDATE SKIP LOCKED`, status pending
  - `markInboundEventProcessed(scope, id)` / `markInboundEventFailed(scope, id, error)`

Insert SQL must use `ON CONFLICT (org_id, channel, external_id) DO NOTHING RETURNING id` — if no row, `inserted: false` (caller still returns 200).

When `inserted: true`, same transaction: `enqueueEvent(scope, client, { topic: "inbound.message_received", payload: { inboundEventId: id } })`.

- [ ] **Step 1: Unit tests** for insert+enqueue path (mock client.query sequence) and conflict path (`rows=[]` → inserted false, no enqueue).

- [ ] **Step 2–4: Implement + pass.** Step 5: Commit `feat(s15): inbound_events persistence module`.

---

### Task 9: Match or create enquiry

**Files:**
- Create: `ads-agent/lib/inbound/match.ts`
- Create: `ads-agent/lib/inbound/match.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md`

**Interfaces:**
- Consumes: T5–T7 exports + `createContact` / `createEnquiry`
- Produces:
```ts
export type MatchInput =
  | { channel: "email"; mailboxHash: string | null; fromName: string; fromEmail: string }
  | { channel: "whatsapp"; fromPhoneRaw: string; profileName?: string | null };

export type MatchResult = { enquiry: Enquiry; contact: Contact | null; created: boolean };

export async function matchOrCreateEnquiry(scope: Scope, input: MatchInput): Promise<MatchResult>;
```

Rules (from spec):
- email + non-empty hash → `findEnquiryByReplyToken`; on hit load contact if `contactId`
- email miss / empty → `createContact` + `createEnquiry` (`created: true`)
- whatsapp → normalize phone; `findContactByPhone`; `findOpenEnquiryForContact`; else create both

- [ ] **Step 1: Tests with mocked db modules** (`vi.mock("../db/contacts")` etc.) covering match hit, WA create, email create.

- [ ] **Step 2–4: Implement + pass.** Step 5: Commit `feat(s15): inbound matchOrCreateEnquiry`.

---

### Task 10: Media download → `putArtifact`

**Files:**
- Create: `ads-agent/lib/inbound/media.ts`
- Create: `ads-agent/lib/inbound/media.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md`

**Interfaces:**
```ts
export type InboundMediaItem = {
  source: "whatsapp" | "postmark";
  mediaType: string;       // mime
  filenameHint?: string;
  /** WA media id or inline bytes */
  whatsappMediaId?: string;
  bytes?: Uint8Array;
};

export async function storeInboundMedia(
  scope: Scope,
  subject: { enquiryId: string; contactId?: string | null },
  items: InboundMediaItem[],
  deps?: {
    fetchWhatsAppMedia?: (mediaId: string) => Promise<{ bytes: Uint8Array; mime: string }>;
    putArtifact?: typeof putArtifact;
  },
): Promise<{ artifactIds: string[]; skipped: string[] }>;
```

- Cap each item at `INBOUND_MEDIA_MAX_BYTES`; oversize → push reason to `skipped`, no throw.
- Default WA fetch: Graph `GET /{media-id}` with `WHATSAPP_ACCESS_TOKEN` then download `url` (exact Meta flow — implement against current Graph docs; keep injectable for tests).
- `putArtifact(scope, { contentType: "inbound_media", mediaType, body, subjectRefs: [enquiryId, contactId].filter(Boolean) })`.

- [ ] **Step 1: Unit tests** with mocked fetch/put — success, oversize skip, empty list.

- [ ] **Step 2–4: Implement + pass.** Step 5: Commit `feat(s15): store inbound media in Garage`.

---

### Task 11: WhatsApp inbound route

**Files:**
- Create: `ads-agent/app/api/inbound/whatsapp/route.ts`
- Create: `ads-agent/app/api/inbound/whatsapp/route.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md`, `~/.cursor/skills/engineering-skills/senior-security/SKILL.md`

**Interfaces:**
- Consumes: T3 verify, T8 insert (via `withTenantTransaction` + client)
- GET: hub challenge → `200` text/plain challenge; else `403`
- POST: read **raw** body string; verify signature; parse JSON; for each `messages[]` entry extract `id` as `external_id`; call insert; always `200` after verify success (even if inserted false)

Extract helper `extractWhatsAppMessageEvents(payload: unknown): { externalId: string; payload: unknown }[]` in same file or `lib/inbound/whatsapp-parse.ts` if cleaner — keep in `lib/inbound/whatsapp-parse.ts` if route file would exceed ~120 lines.

- [ ] **Step 1: Route tests** with mocked verify + insert.

- [ ] **Step 2–4: Implement + pass.** Step 5: Commit `feat(s15): WhatsApp inbound webhook route`.

---

### Task 12: Postmark inbound route

**Files:**
- Create: `ads-agent/app/api/inbound/email/route.ts`
- Create: `ads-agent/app/api/inbound/email/route.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md`, `~/.cursor/skills/engineering-skills/senior-security/SKILL.md`

**Interfaces:**
- POST only: Basic Auth via T4; body JSON; `external_id = MessageID`; store full JSON as payload; `200` on success; `401` on auth fail.

- [ ] **Step 1–4: TDD.** Step 5: Commit `feat(s15): Postmark inbound webhook route`.

---

### Task 13: Process inbound event (worker core)

**Files:**
- Create: `ads-agent/lib/inbound/process.ts`
- Create: `ads-agent/lib/inbound/process.test.ts`
- Create: `ads-agent/scripts/run-inbound-worker.ts`
- Modify: `ads-agent/package.json` — add `"worker:inbound": "tsx --env-file=.env.local scripts/run-inbound-worker.ts"`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md`, `~/.cursor/skills/engineering-skills/ai-security/SKILL.md`

**Interfaces:**
```ts
export async function processInboundEvent(
  event: InboundEvent,
  deps?: { /* inject match, media, addMessage, refreshEnquirySignals, mark* */ },
): Promise<void>;
```

Algorithm:
1. Parse channel-specific fields from `event.payload`.
2. `matchOrCreateEnquiry`.
3. Build media items (WA image/document/audio/video ids; Postmark `Attachments[].Content` base64 → bytes).
4. `storeInboundMedia` — if any required media failed unexpectedly, mark failed and return (retry).
5. Build body text (TextBody / WA text) or placeholders for media-only (`[image]`, etc.) + append skipped notes.
6. `addMessage(scope, { enquiryId, channel, body, externalId: event.externalId, replyToken: enquiry.inboundReplyToken })`.
7. `refreshEnquirySignals(scope, enquiryId)`.
8. `touchLastActivity` if exported; else rely on message path.
9. `markInboundEventProcessed`.

Worker script: mirror `run-proposal-undo-worker.ts` — cron every few seconds, `claimPendingInboundEvents(10)`, process each, log errors, `INBOUND_WORKER=0` disables.

- [ ] **Step 1: Unit tests** for text-only happy path and media-before-message ordering (assert mock call order).

- [ ] **Step 2–4: Implement + pass.** Step 5: Commit `feat(s15): inbound worker processes events`.

---

### Task 14: Gate, env, runbook, docs

**Files:**
- Create: `ads-agent/lib/inbound/s15-gate.test.ts`
- Create: `docs/superpowers/specs/2026-08-13-s15-inbound-expansion-runbook.md`
- Modify: `ads-agent/.env.example` — document new vars
- Modify: `docs/superpowers/specs/2026-08-13-s15-inbound-expansion-design.md` — Status → `approved (plan written; await execution)`
- Modify: `openmemory.md` — note plan path under Patterns if present

**Skills:** `superpowers:verification-before-completion`, `~/.cursor/skills/engineering-skills/senior-qa/SKILL.md`, `~/.cursor/skills/engineering-skills/senior-devops/SKILL.md`, `~/.cursor/skills/engineering-skills/code-reviewer/SKILL.md`, `~/.cursor/skills/engineering-skills/adversarial-reviewer/SKILL.md`

**Gate assertions (static + unit):**
1. `OUTBOX_TOPICS` includes `inbound.message_received`.
2. `ARTIFACT_CONTENT_TYPES` includes `inbound_media`.
3. No file under `ads-agent/lib/inbound` or `app/api/inbound` imports a send client / `messages` POST to Graph except media GET.
4. `addMessage` default `is_untrusted` remains true (re-read source assertion).
5. Re-export or smoke-import `processInboundEvent`, both routes, verify helpers.

Runbook sections: Meta app webhook URL `https://<ads>/api/inbound/whatsapp`, verify token, Postmark inbound webhook + Basic Auth, `PLATFORM_ORG_ID`, `npm run worker:inbound`, replay failed events SQL, erasure note.

- [ ] **Step 1: Write gate test + runbook + env example.**
- [ ] **Step 2: Run** `npx vitest run lib/inbound lib/db/inbound-events.test.ts lib/events/topics.db.test.ts lib/artifacts/key.test.ts app/api/inbound` — all green.
- [ ] **Step 3: Commit** `test(s15): inbound expansion gate and runbook` (when authorized).

---

## Self-review (author)

1. **Spec coverage:** B2/B3/B4, fast-ack, media Garage, platform org, Postmark+Meta, unmatched create, reply token, dedupe, BD2, tests/gate, env — mapped to T1–T14. Middleware change N/A (api excluded). Twenty projection: existing contact sync via `createContact` pending claims — no new topic required beyond inbound outbox.
2. **Placeholders:** None intentional; WA Graph media fetch details left to implementer against current Meta docs but injectable in tests.
3. **Types:** `MatchInput` / `InboundEvent` / `storeInboundMedia` / `processInboundEvent` names consistent across T8–T13.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-13-s15-inbound-expansion.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch up to **8** W1 tasks in parallel (worktrees), review, then W2 (4), then W3 (2); use `superpowers:subagent-driven-development` + `dispatching-parallel-agents`.

2. **Inline Execution** — `superpowers:executing-plans` in this session with checkpoints.

Which approach?
