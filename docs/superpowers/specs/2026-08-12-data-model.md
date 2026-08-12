# Data model

Date: 2026-08-12
Status: draft for review
Implements: `2026-08-12-unified-datastore-context-graph-design.md`,
`2026-08-12-backend-features-design.md`, `2026-08-12-agent-topology-design.md`,
`2026-08-11-tenancy-authz-foundation-design.md`
Corrects the defects in `2026-08-12-architecture-validation-report.md` §4

Covers all four stores: PostgreSQL (system of record), ClickHouse (analytical mirror and graph),
DuckDB (per-tenant snapshots), and the graph node/edge model itself.

---

## 0. Conventions

These are not style preferences. Each one prevents a specific failure found during validation.

| Convention | Why |
|---|---|
| **Every object is `schema.`-qualified** | The deployed role has `search_path = "ag_catalog, $user, public"`. An unqualified `CREATE TABLE` lands **inside the AGE extension's schema** — already documented in `009_listing_enrichment_log.sql`. |
| **`id UUID PRIMARY KEY DEFAULT uuidv7()`** | Native in PostgreSQL 18. Time-ordered, so inserts append to the B-tree rather than scattering as `gen_random_uuid()` does. Every table here carries an `(org_id, created_at)` index where locality matters. |
| **`org_id UUID NOT NULL` on every domain table** | Tenancy is the substrate. No exceptions; a table without it cannot be RLS-protected. |
| **Every index leads with `org_id`** | A missing leading-edge tenant index *"quietly destroys customer-facing query latency at scale."* |
| **`ENABLE` *and* `FORCE ROW LEVEL SECURITY`** | Table owners ignore RLS unless forced. Without this the tenant variable is set correctly and enforces nothing (validation F-20). |
| **Suppression columns, not `DELETE`** | DPDP Rule 8(3) requires a one-year retention floor even after a user deletes their account (validation F-16). |
| **`TIMESTAMPTZ`, never `TIMESTAMP`** | Bangalore-based product with international clients. |
| **Numbered up/down migrations** | Replaces `ads-agent`'s idempotent whole-schema re-run, where anything expressed inside a `CREATE TABLE` body silently never applies to a provisioned database. |

### Target versions

- **PostgreSQL 18** — for native `uuidv7()`.
- **Apache AGE `PG18/v1.8.0-rc0`** — every AGE release carries the `-rc0` suffix, including the
  `PG16/v1.6.0-rc0` currently in production, so this is the same maturity. Adds row-level security
  support for graph data. `docker/Dockerfile.postgres` moves from `pgvector/pgvector:pg16` and
  `AGE_BRANCH=release/PG16/1.6.0` to the PG18 equivalents; confirm the exact branch name at build.
- **pgvector** — as shipped in the `pg18` base image.

### Schema layout

One instance, four schemas, one database role per schema plus grants.

| Schema | Owns | Role |
|---|---|---|
| `listings` | listings, sync, search, enrichment | `listings_rw` |
| `adsagent` | campaigns, proposals, enquiries, credits | `adsagent_rw` |
| `context` | control plane, agent state, compliance ledgers | `context_rw` |
| `public` | shared reference data (`orgs`, `users`, `corridor`) | `shared_rw` |

**The MCP context server connects as a distinct read-only, non-owner role** (`agent_ro`) holding
`SELECT` on tenant-scoped views only. This is what makes `FORCE ROW LEVEL SECURITY` meaningful.

---

## 1. Tenancy primitives

### 1.1 The tenant-context helper

Every path into the database goes through this. Nothing sets the variable directly.

```sql
CREATE OR REPLACE FUNCTION public.set_tenant(p_org_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'set_tenant called with NULL org_id';
  END IF;
  -- third argument true => transaction-scoped. Without it the setting persists
  -- on the pooled connection and the next request inherits this tenant.
  PERFORM set_config('app.current_tenant_id', p_org_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.current_tenant()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
$$;
```

`current_setting(..., true)` returns NULL rather than erroring when unset, so a policy comparing
against it denies rather than crashes — fail closed.

### 1.2 The policy applied to every tenant table

```sql
-- Template. Applied to every table in §3 and §4.
ALTER TABLE adsagent.enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.enquiries FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.enquiries
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());
```

`WITH CHECK` matters as much as `USING`: without it a tenant can *write* rows carrying another
tenant's `org_id`.

### 1.3 Reusable domains

```sql
CREATE DOMAIN public.org_ref AS UUID;

-- Suppression, not deletion. See §6.
CREATE TYPE public.lifecycle_state AS ENUM ('active', 'suppressed', 'erased');
```

---

## 2. Fixes to existing tables

Three live defects from the validation report. All expressed as `ALTER`, because changes written
inside a `CREATE TABLE` body never reach a provisioned database.

```sql
-- F-2: the schema permits only admin|member while the code expects
-- admin|operator|viewer, so two of three roles cannot be stored at all.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE public.users SET role = 'operator' WHERE role = 'member';
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (role IN ('admin','operator','viewer'));
ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'viewer';

-- F-7: the human-gated workflow recorded no human.
ALTER TABLE adsagent.proposals
  ADD COLUMN IF NOT EXISTS decided_by     UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS org_id         public.org_ref,
  ADD COLUMN IF NOT EXISTS scheduled_for  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS undo_until     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proposed_by    TEXT,      -- agent profile name, NULL when human
  ADD COLUMN IF NOT EXISTS evidence       JSONB NOT NULL DEFAULT '[]';

-- cron_settings was a global singleton (id INT PRIMARY KEY DEFAULT 1, CHECK (id = 1)).
CREATE TABLE IF NOT EXISTS adsagent.org_cron_settings (
  org_id       public.org_ref PRIMARY KEY REFERENCES public.orgs(id),
  enabled      BOOLEAN NOT NULL DEFAULT false,
  last_run_at  TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill org_id on every domain table, then enforce.
ALTER TABLE adsagent.campaigns ADD COLUMN IF NOT EXISTS org_id public.org_ref;
-- ... backfill ...
ALTER TABLE adsagent.campaigns ALTER COLUMN org_id SET NOT NULL;
```

---

## 3. Enquiry spine

The core gap: enquiries are currently fire-and-forget into Twenty with nothing stored locally.
Twenty remains system of record for the person and opportunity; these tables hold what Twenty's API
structurally cannot (call logs, custom timeline events, reply state).

```sql
CREATE TABLE adsagent.enquiries (
  id                    UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id                public.org_ref NOT NULL REFERENCES public.orgs(id),

  twenty_opportunity_id TEXT UNIQUE,          -- system of record key
  twenty_person_id      TEXT,

  listing_id            UUID REFERENCES listings.listings(id),
  listing_url           TEXT,                 -- as captured, before resolution
  corridor_id           UUID REFERENCES public.corridors(id),

  reply_state           TEXT NOT NULL DEFAULT 'waiting'
                          CHECK (reply_state IN ('waiting','called','closed')),
  -- deliberately separate from Twenty's pipeline stage: that is a deal stage,
  -- this is "does this need me today".

  contact_name          TEXT,
  contact_phone         TEXT,                 -- encrypted at rest, see §6.3
  contact_email         TEXT,

  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  lifecycle             public.lifecycle_state NOT NULL DEFAULT 'active',
  suppressed_at         TIMESTAMPTZ,
  erase_after           DATE,                 -- retention floor, see §6

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX enquiries_org_activity_idx
  ON adsagent.enquiries (org_id, last_activity_at DESC)
  WHERE lifecycle = 'active';

CREATE INDEX enquiries_org_state_idx
  ON adsagent.enquiries (org_id, reply_state, last_activity_at DESC)
  WHERE lifecycle = 'active';

CREATE INDEX enquiries_org_listing_idx ON adsagent.enquiries (org_id, listing_id);
```

```sql
-- Inbound only. Outbound is voice; there is no send path (BD2).
CREATE TABLE adsagent.enquiry_messages (
  id             UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id         public.org_ref NOT NULL REFERENCES public.orgs(id),
  enquiry_id     UUID NOT NULL REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,

  channel        TEXT NOT NULL CHECK (channel IN ('web_form','email','whatsapp')),
  direction      TEXT NOT NULL DEFAULT 'inbound' CHECK (direction = 'inbound'),
  body           TEXT NOT NULL,
  external_id    TEXT,                        -- provider message id, for dedupe
  reply_token    TEXT,                        -- how an inbound email threads back

  -- Untrusted content. Agents reading this must treat it as tainted (agent spec §7).
  is_untrusted   BOOLEAN NOT NULL DEFAULT true,

  received_at    TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (org_id, channel, external_id)
);

CREATE INDEX enquiry_messages_org_enquiry_idx
  ON adsagent.enquiry_messages (org_id, enquiry_id, received_at DESC);
```

```sql
-- Append-only. This is what Twenty cannot hold.
CREATE TABLE adsagent.enquiry_activities (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        public.org_ref NOT NULL REFERENCES public.orgs(id),
  enquiry_id    UUID NOT NULL REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,

  kind          TEXT NOT NULL CHECK (kind IN ('call','note','state_change','reminder_set')),
  actor_user_id UUID REFERENCES public.users(id),

  -- call fields, null for other kinds
  call_outcome  TEXT CHECK (call_outcome IN
                  ('spoke_interested','spoke_not_interested','no_answer',
                   'voicemail','wrong_number','callback_requested')),
  call_direction TEXT CHECK (call_direction IN ('outgoing','incoming')),
  call_seconds   INTEGER CHECK (call_seconds >= 0),
  occurred_at    TIMESTAMPTZ NOT NULL,

  body           TEXT,
  synced_to_twenty_at TIMESTAMPTZ,            -- Notes API write-back

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX enquiry_activities_org_enquiry_idx
  ON adsagent.enquiry_activities (org_id, enquiry_id, occurred_at DESC);
```

```sql
-- Current requirement. Revisions carry the audit trail.
CREATE TABLE adsagent.enquiry_requirements (
  enquiry_id      UUID PRIMARY KEY REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,
  org_id          public.org_ref NOT NULL REFERENCES public.orgs(id),

  desks_min       INTEGER CHECK (desks_min > 0),
  desks_max       INTEGER CHECK (desks_max >= desks_min),
  budget_per_desk_inr NUMERIC(12,2) CHECK (budget_per_desk_inr >= 0),
  move_in_by      DATE,
  must_haves      TEXT[] NOT NULL DEFAULT '{}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Extraction proposes; a human confirms. Never auto-applied (backend spec C3).
CREATE TABLE adsagent.enquiry_requirement_revisions (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        public.org_ref NOT NULL REFERENCES public.orgs(id),
  enquiry_id    UUID NOT NULL REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,

  source        TEXT NOT NULL CHECK (source IN ('web_form','call_notes','manual','agent')),
  proposed      JSONB NOT NULL,
  applied       BOOLEAN NOT NULL DEFAULT false,
  confirmed_by  UUID REFERENCES public.users(id),
  confirmed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX req_revision_pending_idx
  ON adsagent.enquiry_requirement_revisions (org_id, enquiry_id)
  WHERE applied = false;
```

```sql
CREATE TABLE adsagent.reminders (
  id           UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id       public.org_ref NOT NULL REFERENCES public.orgs(id),
  enquiry_id   UUID REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id),

  due_at       TIMESTAMPTZ NOT NULL,
  note         TEXT,
  state        TEXT NOT NULL DEFAULT 'pending'
                 CHECK (state IN ('pending','fired','done','cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drives the Today feed; partial index keeps it small as history grows.
CREATE INDEX reminders_due_idx ON adsagent.reminders (org_id, due_at)
  WHERE state = 'pending';
```

---

## 4. Attribution

`campaigns.corridor` is currently dead TEXT. Campaigns are corridor-level; enquiries are
listing-level; per-space cost is therefore an allocation, never a measurement.

```sql
CREATE TABLE public.corridors (
  id           UUID PRIMARY KEY DEFAULT uuidv7(),
  slug         TEXT NOT NULL UNIQUE,          -- 'hsr-layout', 'orr-bellandur'
  display_name TEXT NOT NULL,
  city         TEXT NOT NULL DEFAULT 'Bangalore',
  parent_id    UUID REFERENCES public.corridors(id),   -- hierarchy as edges, not paths
  aliases      TEXT[] NOT NULL DEFAULT '{}', -- 'HSR', 'Hosur Sarjapur Road'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Reference data, shared across tenants — deliberately **not** `org_id`-scoped, and therefore not
RLS-protected. `aliases` is what makes lexical search work (`HSR` ↔ `Hosur Sarjapur Road`).

```sql
CREATE TABLE listings.listing_corridors (
  listing_id   UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  corridor_id  UUID NOT NULL REFERENCES public.corridors(id),
  confidence   NUMERIC(3,2) NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  PRIMARY KEY (listing_id, corridor_id)
);

ALTER TABLE adsagent.campaigns
  ADD COLUMN IF NOT EXISTS corridor_id UUID REFERENCES public.corridors(id);
```

---

## 5. Context schema — control plane and agent state

```sql
CREATE TABLE context.graph_manifests (
  org_id         public.org_ref PRIMARY KEY REFERENCES public.orgs(id),
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','building','ready','error')),
  snapshot_id    UUID,                        -- currently-served snapshot
  building_id    UUID,                        -- snapshot under construction
  last_built_at  TIMESTAMPTZ,
  stale_since    TIMESTAMPTZ,                 -- set when material change lands
  error_message  TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The build worker claims work here. Small, contended, transactional --
-- which is why the manifest lives in Postgres and not in ClickHouse.
CREATE INDEX graph_manifests_stale_idx ON context.graph_manifests (stale_since)
  WHERE status = 'pending';
```

```sql
-- Server-side so it is revocable. The agent never names its own tenant.
CREATE TABLE context.agent_task_tokens (
  token_hash    BYTEA PRIMARY KEY,            -- store the hash, never the token
  org_id        public.org_ref NOT NULL REFERENCES public.orgs(id),
  task_id       TEXT NOT NULL,
  agent_profile TEXT NOT NULL,
  tool_allowlist TEXT[] NOT NULL,             -- binds intent, not only scope
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX agent_task_tokens_live_idx ON context.agent_task_tokens (expires_at)
  WHERE revoked_at IS NULL;
```

```sql
CREATE TABLE context.agent_action_log (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        public.org_ref NOT NULL REFERENCES public.orgs(id),
  agent_profile TEXT NOT NULL,
  task_id       TEXT,
  tool_name     TEXT NOT NULL,
  proposal_id   UUID REFERENCES adsagent.proposals(id),
  tainted_input BOOLEAN NOT NULL DEFAULT false,  -- derived from untrusted text
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 6. Compliance

### 6.1 Deletion is suppression, then scheduled erasure

DPDP Rule 8(3) requires personal data and processing logs to be retained **at least one year**,
expressly including data a processor holds, and expressly even after the subject deletes their
account. So `DELETE` on request would be non-compliant in the opposite direction from the usual
mistake.

```sql
CREATE TABLE context.deletion_requests (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        public.org_ref NOT NULL REFERENCES public.orgs(id),
  subject_kind  TEXT NOT NULL CHECK (subject_kind IN ('enquirer','user','tenant')),
  subject_ref   TEXT NOT NULL,                -- enquiry id, user id, or org id
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  suppressed_at TIMESTAMPTZ,                  -- access blocked; user-visible "deleted"
  erase_after   DATE NOT NULL,                -- requested_at + retention floor
  erased_at     TIMESTAMPTZ,
  -- Rule 14(3): grievance response within 90 days maximum.
  respond_by    DATE NOT NULL
);

-- Per-store propagation. Cascading FK deletes prove nothing to a regulator.
CREATE TABLE context.deletion_propagations (
  request_id  UUID NOT NULL REFERENCES context.deletion_requests(id) ON DELETE CASCADE,
  store       TEXT NOT NULL CHECK (store IN
                ('postgres','clickhouse','duckdb_snapshot','graph','twenty',
                 'vector_index','firestore','langfuse')),
  state       TEXT NOT NULL DEFAULT 'pending'
                CHECK (state IN ('pending','suppressed','erased','failed')),
  detail      TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, store)
);
```

### 6.2 Access log

Rule 6(1)(c) and (e) require access logs retained a year, and breach notification has no
de-minimis threshold — every affected principal, plus a Board report within 72 hours. That is only
answerable with a per-tenant blast-radius query.

```sql
CREATE TABLE context.access_log (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        public.org_ref NOT NULL,
  actor_kind    TEXT NOT NULL CHECK (actor_kind IN ('user','agent','system','cross_tenant')),
  actor_ref     TEXT NOT NULL,
  subject_kind  TEXT,
  subject_ref   TEXT,
  action        TEXT NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (occurred_at);
-- Monthly partitions: retention is a DROP PARTITION, not a mass DELETE.
```

`actor_kind = 'cross_tenant'` is how the privileged analytics service (datastore spec §5.1) is
audited. It is the only actor permitted to read outside a tenant, and every such read lands here.

### 6.3 Encryption

Rule 6(1)(a) names encryption, masking and tokenisation explicitly, so **RLS alone is not a
sufficient safeguard**. `enquiry.contact_phone` and `contact_email` are encrypted at rest with a
per-subject key, so key destruction satisfies erasure in stores where deletion is expensive
(ClickHouse) or impossible (an already-built snapshot).

---

## 7. ClickHouse — analytical mirror and graph

Never authoritative. Fed by CDC. Every table carries `org_id` and a row policy.

```sql
CREATE TABLE enquiry_fact (
  org_id        UUID,
  enquiry_id    UUID,
  listing_id    Nullable(UUID),
  corridor_id   Nullable(UUID),
  reply_state   LowCardinality(String),
  first_seen_at DateTime64(3),
  occurred_on   Date MATERIALIZED toDate(first_seen_at),
  snapshot_id   UUID
) ENGINE = MergeTree
ORDER BY (org_id, occurred_on, enquiry_id);   -- tenant leads, as in Postgres

CREATE ROW POLICY tenant_policy ON enquiry_fact
  USING org_id = toUUID(getSetting('SQL_current_tenant_id')) TO ALL;
```

The graph, as tables — no graph engine, following GitLab Orbit.

```sql
CREATE TABLE graph_node (
  org_id      UUID,
  snapshot_id UUID,
  node_id     UUID,
  node_kind   LowCardinality(String),   -- Space|Corridor|Person|Enquiry|Campaign|Call|POI|Outcome
  label       String,
  subject_ref Nullable(String),         -- provenance, so erasure can prune (validation F-18)
  props       JSON
) ENGINE = MergeTree
ORDER BY (org_id, snapshot_id, node_kind, node_id);

CREATE TABLE graph_edge (
  org_id            UUID,
  snapshot_id       UUID,
  source_id         UUID,
  source_kind       LowCardinality(String),
  relationship_kind LowCardinality(String),
  target_id         UUID,
  target_kind       LowCardinality(String),
  -- typed properties, per ClickHouse guidance: use columns when the shape is known
  meters            Nullable(UInt32),   -- NEAR
  weight            Nullable(Float32),  -- SIMILAR_TO
  confidence        Nullable(Float32),
  props             JSON                -- only genuinely dynamic extras
) ENGINE = MergeTree
ORDER BY (org_id, snapshot_id, source_kind, relationship_kind, source_id);
```

One polymorphic edge table, because a relationship kind spans several node-kind pairs — the
property that made Orbit's own edge table load-bearing across eleven kind-triples.

---

## 8. Graph model

**Node kinds:** `Space`, `Corridor`, `POI`, `Person`, `Organisation`, `Enquiry`, `Requirement`,
`Campaign`, `Call`, `Outcome`.

| Relationship | From → To | Properties |
|---|---|---|
| `PART_OF` | Corridor → Corridor | — (hierarchy as edges, not materialised paths) |
| `LOCATED_IN` | Space → Corridor | — |
| `NEAR` | Space → POI | `meters` |
| `ENQUIRED_ABOUT` | Person → Space | — |
| `WORKS_FOR` | Person → Organisation | — |
| `HAS_REQUIREMENT` | Enquiry → Requirement | — |
| `TARGETS` | Campaign → Corridor | — |
| `GENERATED` | Campaign → Enquiry | `confidence` (attribution is inferred) |
| `ABOUT` | Call → Enquiry | — |
| `RESULTED_IN` | Enquiry → Outcome | — |
| `SIMILAR_TO` | Space → Space | `weight` |

`NEAR` carries POI data sourced from **OpenStreetMap, not Google Places** — Places forbids
pre-fetching or storing its content beyond narrow exceptions, and a persisted proximity index is
exactly that.

---

## 8a. Firestore — artifact content (added 2026-08-12)

Not a schema in the SQL sense; Firestore is schemaless by design. What is fixed is the **path
convention**, because that is what carries tenancy.

```
artifacts/{org_id}/agent_outputs/{artifact_id}
artifacts/{org_id}/trace_payloads/{span_id}
artifacts/{org_id}/context_packs/{pack_id}
```

Every document carries these fields regardless of its payload shape, so the compliance and cost
machinery can operate without knowing the shape:

| Field | Type | Why |
|---|---|---|
| `org_id` | string | redundant with the path, and checked on read — a mismatch is a bug, not a miss |
| `subject_refs` | string[] | data subjects whose personal data appears, so erasure can find it |
| `created_at` | timestamp | retention floor arithmetic |
| `erase_after` | timestamp | scheduled hard delete, per DPDP Rule 8(3) |
| `content_type` | string | `talking_points \| draft \| context_pack \| trace_payload` |
| `payload` | map | the variable part — deliberately unconstrained |

Referenced from Postgres by URL, never by foreign key: `adsagent.proposals.evidence` and trace spans
hold `artifacts/{org_id}/…` paths. A dangling reference after erasure is expected and must render as
"content erased", not as an error.

**Access:** Admin SDK, server-side only, with the `{org_id}` segment supplied by the tenant helper —
never from a request parameter. Reads pass through one accessor that counts operations per tenant per
day against the cost ceiling.

**Erasure:** recursive delete on `artifacts/{org_id}` for tenant offboarding; query by `subject_refs`
for per-subject erasure. Both write to `context.deletion_propagations` with `store = 'firestore'`.

## 9. DuckDB per-tenant snapshot

One file per tenant, exported from ClickHouse, opened `READ_ONLY` by serving processes.

Contains `graph_node` and `graph_edge` for a single `org_id` and a single `snapshot_id`, with the
`org_id` column retained so a mis-targeted file fails a check rather than serving silently, plus a
one-row `snapshot_meta` table (`org_id`, `snapshot_id`, `built_at`, `expires_at`, `source_watermark`).

Three rules from the design: builds never write in place, since readers hold the file; `expires_at`
is a **compliance control**, not housekeeping, because these files outlive deletion by construction;
and `source_watermark` carries CDC lag forward so an agent can tell how stale its context is
(validation F-5).

---

## 10. Migration plan

Numbered up/down pairs, replacing the whole-schema re-run.

| # | Migration | Reversible |
|---|---|---|
| 010 | PG18 + AGE PG18 base image; verify extensions | image rollback |
| 011 | Create `adsagent`, `context` schemas; roles and grants | drop |
| 012 | `pg_dump` restore of `ads_agent` into the `adsagent` schema | drop schema |
| 013 | Fixes from §2 — role CHECK, `decided_by`, per-org cron | yes |
| 014 | `org_id` backfill on domain tables, then `SET NOT NULL` | drop columns |
| 015 | `set_tenant`/`current_tenant` helpers; RLS enable+force+policies | drop policies |
| 016 | Enquiry spine (§3) | drop tables |
| 017 | Corridor and attribution (§4) | drop tables |
| 018 | Context schema (§5) | drop tables |
| 019 | Compliance tables and partitioning (§6) | drop tables |
| 020 | `agent_ro` role and tenant-scoped views | revoke, drop |

**015 is the release gate.** Its acceptance test is the cross-tenant suite from the tenancy spec:
set tenant A, attempt to read a tenant B row by primary key, assert zero rows — run against every
table in §3 to §6, and against a pooled connection to prove the transaction-scoping holds.

---

## 11. Schema analysis

Run through `database-designer`'s `schema_analyzer.py` rather than reviewed by eye. Two caveats
worth recording, because the output should not be taken at face value.

**The parser could not read this DDL properly.** It matches table names with `(\w+)`, so
schema-qualified names break it, and it reported 16 columns across 15 tables with zero foreign keys
— both obviously wrong. Analysis was re-run against a copy with schema prefixes stripped, and its
constraint findings (`listing_corridors` and `deletion_propagations` "have no primary key",
`enquiry_requirements.enquiry_id` "has no constraint") are **false positives**: all three are
declared, two as table-level composite primary keys and one as an inline `REFERENCES`.

**One finding was real and has been applied.** Every new table was originally singular
(`enquiry`, `reminder`, `corridor`), which conflicts with the established convention — the existing
eighteen tables are plural for entities (`campaigns`, `proposals`, `credit_grants`, `sync_runs`) and
singular only for collective nouns (`ai_action_log`, `usage_ledger`). All new entity tables are now
plural; `agent_action_log` and `access_log` stay singular to match `ai_action_log`.

Normalization and data-type analysis returned no issues, though given the parse failure that is
weak evidence rather than a clean bill of health.

## 12. Open questions

1. **Encryption mechanism for §6.3** — `pgcrypto` in-database, or application-side envelope
   encryption with keys in GCP KMS? KMS is stronger and lets key destruction be the erasure
   primitive, at the cost of losing SQL-side search on those columns.
2. **Corridor vocabulary seed** — listing areas are free text from scrapers. Who defines the
   canonical corridor list, and how are existing listings mapped?
3. **Retention floor start date** — does `erase_after` run from the deletion request or from last
   activity? The Rules do not say, and it changes the schedule.
4. **`twenty_opportunity_id` uniqueness** — currently globally unique; should it be unique per
   `org_id` instead, if two tenants could ever see the same Twenty record?
5. **Partition cadence for `access_log`** — monthly assumed; depends on volume once agents run.
