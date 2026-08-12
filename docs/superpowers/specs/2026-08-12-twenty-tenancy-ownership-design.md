# Twenty CRM — per-tenant isolation and data ownership

Date: 2026-08-12
Status: design, awaiting review
Closes: open question **B1** (Postgres/Twenty field boundary), dataflow review **A-1**
Supersedes: the interim containment in the tenancy spec's Q4 resolution — that guard stays, but this
document defines the end state it is waiting for.

## 1. Why this exists

The enquiry spine (S4) has to write contact data somewhere. Two systems could own it, and if the
boundary is left implicit the spine will encode one by accident. This document sets the boundary, and
resolves the tenancy model it depends on.

Two facts drive everything below.

**Twenty has no human user.** Brokers only ever see this application. Twenty is a headless engine kept
for three capabilities we would otherwise rebuild: duplicate detection, pipeline stages, and export.
Its UI is not part of the product.

**Duplicate detection is why a shared instance is unsafe.** Twenty's dedup is a feature, and in a
shared instance it does its job across tenant lines: two brokers with the same contact get resolved to
one person record carrying both tenants' opportunities and a merged history. This is not a
read-permission problem that hiding a route would fix — a merge destroys the information needed to
reverse it. Isolation is therefore a correctness requirement, not a hardening measure.

## 2. Decisions

- **TW1 — One Twenty instance per org.** Not one workspace per org. Each instance runs Twenty's
  default single-workspace mode (`IS_MULTIWORKSPACE_ENABLED=false`), which is the best-tested
  configuration; multi-workspace mode is thinly documented and carries open upstream issues.
- **TW2 — Twenty owns identity; Postgres owns everything that happens.** Full table in §3.
- **TW3 — On identity fields Twenty wins; on everything else Postgres wins and Twenty is a
  projection.**
- **TW4 — Twenty is never synchronous on enquiry capture.** The enquiry commits to Postgres first and
  enriches asynchronously through the outbox (S5a).
- **TW5 — Enquiries reference a local contact row, never a Twenty id directly.** This confines the
  blast radius of a dedup merge to one table.
- **TW6 — Provisioning runs through Coolify**, which already deploys this stack. Twenty's own APIs are
  not used for provisioning because they do not exist.
- **TW7 — Gentle Space is itself a tenant.** The marketing site's leads go to the Gentle Space org's
  own instance. There is no special platform path.
- **TW8 — The contaminated shared instance is not migrated.** It becomes read-only and platform-only.

## 3. The ownership boundary

**Twenty owns *who*. Postgres owns *what happened*.**

Twenty is authoritative for identity because dedup means Twenty is the component deciding that two
contacts are one person. If Postgres owned identity independently the two would drift and dedup would
be meaningless. Everything else is ours, because the broker drives it from our UI and Twenty has no
user to disagree.

| Data | Owner | Why | Sync direction |
|---|---|---|---|
| Name, phone, email, company | **Twenty** | dedup decides who is who | Twenty → Postgres cache |
| `twenty_person_id`, `twenty_opportunity_id` | **Twenty** | it issues them | Twenty → Postgres |
| The enquiry | **Postgres** | our concept; Twenty has no equivalent | Postgres → Twenty as Opportunity |
| Enquiry and reply state | **Postgres** | the broker drives it from our UI | Postgres → Twenty stage |
| Calls, notes, outcomes | **Postgres** | must be queryable and agent-readable | Postgres → Twenty Notes, for export completeness |
| Requirements — size, corridor, budget | **Postgres** | our domain model | optional, to custom fields |
| Reminders | **Postgres** | our scheduler | not synced |
| Proposals, credits, consent, artifacts | **Postgres** | never leaves | not synced |

**Conflict resolution.** A broker correcting a phone number writes locally for immediate feedback,
the change is pushed to Twenty, and **Twenty's response overwrites our cache** — because its dedup may
have merged the record into another one, and the merged result is the truth. On every non-identity
field Postgres is authoritative and a disagreement means the projection failed, which is a bug to fix
rather than a conflict to resolve.

## 4. Local schema

Contacts are a table, not columns on the enquiry, because one person raises many enquiries and a merge
must be handled in one place.

```sql
CREATE TABLE adsagent.contacts (
  id               UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id           UUID NOT NULL REFERENCES public.orgs(id),
  -- Nullable until the first sync lands. Twenty is authoritative for this id.
  twenty_person_id TEXT,

  -- Cache of Twenty-owned fields. Never edited in place by product code;
  -- overwritten wholesale by sync. Present so the enquiry list renders
  -- without an API call per row.
  name             TEXT NOT NULL,
  phone            TEXT,
  email            TEXT,
  synced_at        TIMESTAMPTZ,
  sync_state       TEXT NOT NULL DEFAULT 'pending'
                     CHECK (sync_state IN ('pending','synced','failed','merged_away')),

  -- Set when Twenty merges this person into another. The row survives as a
  -- tombstone so existing enquiry references keep resolving.
  merged_into      UUID REFERENCES adsagent.contacts(id),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, twenty_person_id)
);

CREATE INDEX ON adsagent.contacts (org_id, sync_state) WHERE sync_state <> 'synced';
ALTER TABLE adsagent.contacts ENABLE ROW LEVEL SECURITY;
```

Enquiries carry `contact_id` referencing this table. They never store `twenty_person_id`, which is
what makes TW5 hold: when Twenty merges two people, exactly one table needs repair and every enquiry,
proposal and graph edge keeps pointing at something valid.

## 5. Connection registry

```sql
CREATE TABLE context.twenty_connections (
  org_id               UUID PRIMARY KEY REFERENCES public.orgs(id),
  base_url             TEXT NOT NULL,
  -- A pointer into the secret store, never the key itself, so this table is
  -- safe to back up and read, and open question B4 can be settled later
  -- without a schema change.
  api_key_ref          TEXT NOT NULL,
  coolify_service_uuid TEXT NOT NULL UNIQUE,
  -- N instances drift. The client must know what it is talking to.
  twenty_version       TEXT NOT NULL,
  state                TEXT NOT NULL CHECK (state IN
                         ('provisioning','active','suspended','deprovisioned','failed')),
  provisioned_at       TIMESTAMPTZ,
  last_sync_at         TIMESTAMPTZ,
  last_error           TEXT
);
```

The API key is scoped in Twenty to a role carrying only person and opportunity access. A key able to
administer the workspace is not needed and must not be issued.

## 6. Client consolidation

Today there are **three** ways to reach Twenty, all process-wide singletons: `lib/crm/twenty.ts` and
`ads-agent/lib/connectors/twenty.ts` each carry a duplicate `baseUrl()` reading `TWENTY_BASE_URL`, and
`ads-agent/lib/bifrost/twenty-mcp-tools.ts` points at a sidecar on `TWENTY_MCP_URL`. None can become
tenant-aware as written, so consolidation is a precondition rather than an optional tidy-up.

**One resolver.** `getTwentyClient(orgId)` reads the registry, fetches the secret, and returns a client
bound to that org. Constructing a Twenty client any other way is the equivalent of a missing
`scopeClause`. It **throws** when the connection is absent, suspended, or not `active` — returning an
empty result would be indistinguishable from a customer with no contacts, which is how a leak hides.

**The MCP sidecar is removed.** It holds one API key and cannot route per tenant. Twenty is exposed to
agents through the MCP context server (S9), which already resolves tenant. This deletes a component
rather than adding one, and removes a second credential model.

## 7. Write paths

**Enquiry capture.** Enquiry commits to Postgres with a `contacts` row in `sync_state = 'pending'`,
and an outbox row in the same transaction. The relay publishes; a consumer upserts the person into
that org's Twenty, creates the Opportunity, and writes back `twenty_person_id`,
`twenty_opportunity_id` and the canonical field values. Nothing on the request path touches Twenty, so
an outage delays enrichment and never loses an enquiry.

**State changes.** Reply state, call outcomes and notes commit to Postgres and project outward through
the same outbox. A failed projection is retried and surfaces on `last_error`; it never blocks the
broker.

**Identity edits.** Written locally for immediate feedback, pushed to Twenty, and reconciled from
Twenty's response per §3.

## 8. Edge cases

**Dedup merge.** Twenty resolves two people into one and the surviving id differs from the stored one.
The sync consumer sets the losing row to `sync_state = 'merged_away'` with `merged_into` pointing at
the survivor. Reads follow one hop; a chain longer than one hop is a bug and is logged as such rather
than followed recursively.

**Twenty unreachable.** Enquiries still land. Contacts stay `pending`, retried with backoff, and the
UI shows contact details as pending rather than absent — an empty field and an unsynced field must not
look the same.

**Instance suspended.** `getTwentyClient` throws, so callers degrade explicitly. Suspension is a
deliberate cost lever for inactive customers, not a failure.

**Version skew.** `twenty_version` is compared against the expected version on each sync; a mismatch
raises an alert. Upgrades roll out to one canary tenant before the rest.

## 9. Provisioning and lifecycle

Automated through Coolify, which already deploys this stack via `service create` with
`docker_compose_raw`, per-tenant environment through `env_vars`, and the tenant domain through
`update_application`.

1. Create the service from the Twenty compose definition; record `coolify_service_uuid`.
2. Set per-tenant environment, including a database on the shared Postgres server.
3. Assign the FQDN and deploy; wait for health.
4. Complete first-run setup to create the workspace.
5. **Manual step:** generate an API key in Twenty's settings. Twenty exposes no endpoint for this. If
   a server CLI path exists this step can be automated later; it is not assumed.
6. Store the key in the secret store, write the registry row, set `state = 'active'`.

**Sizing.** Twenty's documented minimum is **2GB RAM per instance**. Pointing each instance at a
database on a shared Postgres server keeps the marginal cost to the server and worker containers, but
the total scales linearly with customers and is the dominant infrastructure cost in this architecture.

**Deprovisioning** is `service delete` with `delete_volumes`, which destroys a customer's entire CRM
footprint in one call.

## 10. Compliance

Per-tenant instances give the cleanest erasure boundary in the system: offboarding destroys the
instance and its database together, leaving nothing to sweep. Per-subject erasure deletes the person in
that org's Twenty and the local `contacts` row. Both write `context.deletion_propagations` with
`store = 'twenty'`, which the enum already carries.

The local cache holds personal data and therefore inherits the same retention rules as any other
personal data in Postgres. It is a cache in the sense that it is rebuildable, **not** in the sense that
it is exempt.

## 11. Migration

The existing shared instance cannot be split. Dedup has already merged records across tenants and the
merge is not reversible, so any script claiming to separate them would be guessing.

New orgs are provisioned fresh. The shared instance becomes read-only and platform-only, retained for
history under the existing retention rules and decommissioned when nothing references it. The interim
containment in the tenancy spec's Q4 resolution — the client-level platform-only guard — stays in force
until every org has its own instance, and is removed only then.

## 12. Build sequence placement

| Step | Work |
|---|---|
| **S3** | Client consolidation and the platform-only guard, per the Q4 resolution |
| **S4** | `adsagent.contacts`, the ownership boundary, enquiry references contact_id |
| **S4** | `context.twenty_connections`; Gentle Space provisioned as the first tenant |
| **S5a** | Sync consumers move onto the outbox |
| **S9** | Twenty exposed through the MCP context server; sidecar deleted |

Per-tenant provisioning is required before the **second** org exists, not before the first: with one
org, one instance is already per-tenant.

## 13. Non-goals

Twenty's UI is not exposed to brokers. Custom object modelling in Twenty is not used — our domain lives
in Postgres. Bidirectional sync of anything outside §3 is not built. Twenty is not a reporting surface;
analytics come from ClickHouse.

## 14. Open questions

1. **Can an API key be seeded from Twenty's server CLI?** Would remove the one manual provisioning
   step. Does not block: the manual step is acceptable at current scale.
2. **Suspension threshold** — how long must an org be inactive before its instance is stopped? Needs
   usage data that does not exist yet.
3. **B4 dependency** — the secret store backing `api_key_ref` is still open. The registry is designed
   so that answer can change without a migration.
