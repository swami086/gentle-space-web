# Customer-facing portal ingestion and consent

Date: 2026-08-12
Status: draft for review
Companions: `2026-08-12-unified-datastore-context-graph-design.md` §11 (data protection), §14 (event backbone),
`2026-08-12-data-model.md`

Brokers embed a script on their own landing page or app. It sends session clickstream to us. This
document covers how that data is collected lawfully, how it arrives, and where it lands.

## 1. Why consent is the architecture, not a feature

Behavioural tracking of Indian residents cannot be done on a legitimate-interest basis, because
**DPDP has no such basis**. [Analysis of the Act](https://www.lexology.com/library/detail.aspx?g=df0f5cc6-c204-4110-8259-9f0f26dc83bd)
is explicit that it *"requires 'Consent' as a legitimate ground of processing personal data (in this
case processing would mean behavioral tracking)"*, and [§4 imposes purpose limitation](https://www.dpdpa.com/dpdpa2023/chapter-2/section4.html):
*"Data collected under legitimate use cannot be repurposed for other activities."*

Two consequences that shape everything below.

**"Collect it because it might be useful later" is not available.** Every event needs a stated
purpose at collection time, and consent for that purpose. A raw zone full of speculatively-collected
behaviour is the specific thing the Act prohibits.

**The broker consents, not us.** They are the Data Fiduciary for their own visitors; we are their
Processor. So the product must give each broker a consent mechanism they configure and present — we
cannot obtain consent on their behalf, and we cannot accept data they have not obtained it for.

That makes the consent gate the load-bearing component: **an event arriving without valid consent for
its stated purpose is rejected at the edge and never stored.** Everything downstream assumes that
guarantee holds.

## 2. Decisions

- **PI1 — Landing pages never write to a datastore.** They POST to a tenant-authenticated ingestion
  endpoint. This preserves the server-side-only property that makes the rest of the storage design
  safe.
- **PI2 — Consent is checked at ingestion**, before publish, before storage. Rejected events are
  counted, not persisted.
- **PI3 — Raw zone is the ClickHouse already being operated**, reached by Pub/Sub's native Cloud
  Storage export subscription and ClickHouse's S3Queue engine. Both hops are configuration rather
  than code, so this needs no new system. BigQuery was considered and rejected once a self-hosted
  path with the same zero-code property was confirmed. Agents never query the raw zone; only
  scheduled transforms do.
- **PI4 — Event taxonomy is fixed and versioned.** Arbitrary event shapes would make purpose
  limitation unenforceable; you cannot state a purpose for a payload you have not defined.
- **PI5 — Sessions are pseudonymous until linked**, and become personal data at the moment of linkage
  (§5).
- **PI6 — Per-tenant consent configuration lives in Postgres**, because it gates writes and must be
  transactional and immediately consistent.

## 3. Consent design

### 3.1 What the broker configures

Each tenant defines their own consent surface, because the notice is theirs to give. Per DPDP Rule 3
a notice must be **standalone**, itemise the data collected, state the **specific purpose**, and link
to withdrawal, rights exercise, and complaint routes.

| Configured per tenant | Why |
|---|---|
| Purposes offered, from a fixed catalogue | Purpose limitation — free-text purposes cannot be enforced downstream |
| Notice copy and language | The broker's own wording, their liability |
| Granularity | Tracking consent requires **granular choices**, not one all-or-nothing toggle |
| Withdrawal route | Rule 3 requires a link to withdraw |

**The purpose catalogue is fixed by us**, not by the broker. Each event type maps to exactly one
purpose, so the ingestion gate can decide mechanically whether consent covers it. A broker inventing
a purpose we cannot map is a configuration error, not a stored event.

### 3.2 What gets recorded

Consent itself is personal data and evidence. Every grant and withdrawal is recorded immutably:
subject reference, purposes granted, notice version shown, timestamp, and the mechanism. Withdrawal
is a new record, never an update — you must be able to show what was true at the time an event was
collected.

### 3.3 Withdrawal has teeth

Withdrawal does two things, and the second is the one systems usually miss:

1. **Collection stops** — subsequent events for that subject and purpose are rejected at the gate.
2. **Prior data is erased** — withdrawal raises a `deletion.requested` event through the same ledger
   as any other erasure (datastore spec §14.4), covering the ClickHouse raw table and every curated
   table derived from it.

Consent that can be withdrawn without erasing what it authorised is not meaningful consent.

## 4. The ingestion edge

```
broker landing page
      │  POST /v1/ingest   (tenant key + origin + consent token)
      ▼
 ingestion endpoint ──reject──▶ counter only, nothing stored
      │ accept
      ├─ validate shape against the versioned taxonomy
      ├─ check consent state for the event's purpose
      ├─ rate-limit per tenant and per session
      ▼
   Pub/Sub  portal.event   (ordering key = org_id)
      │
      ▼  native Cloud Storage export subscription
   GCS raw events bucket   (separate from the snapshot bucket; files deleted after ingest)
      │
      ▼  ClickHouse S3Queue engine + MATERIALIZED VIEW
   ClickHouse raw table ──scheduled transform──▶ Postgres curated · ClickHouse rollups
```

**The tenant key is an identifier, not a secret.** It is embedded in a public page, so it cannot
authenticate anything on its own. Three controls compensate:

- **Origin allowlist per tenant** — requests must come from domains the broker registered.
- **Rate limits per tenant and per session**, since an embeddable key invites abuse.
- **Size and shape caps** before any downstream cost is incurred.

A key that leaks lets someone send junk attributed to that tenant. It must never let them *read*
anything, which is why this endpoint is write-only with no query surface.

## 5. The pseudonymity trap

Session clickstream is collected against a `session_id`, not a person. That looks pseudonymous, and
it is — **until the visitor submits an enquiry.** At that moment the session becomes linkable to a
named individual with a phone number, and every prior event in it becomes personal data
retrospectively.

This is not avoidable, and pretending otherwise is how systems end up non-compliant. The design
faces it:

- The link between `session_id` and enquiry is recorded explicitly when it happens.
- Erasure for an enquirer covers **their linked sessions**, not just the enquiry row.
- Unlinked sessions still expire on a schedule, because "pseudonymous" is not "exempt" — they remain
  personal data under both regimes if re-identification is possible.

## 6. Event taxonomy

Fixed, versioned, one purpose each. Version bumps require a new notice, because the notice itemises
what is collected.

| Event | Purpose it maps to | Payload |
|---|---|---|
| `page_view` | site analytics | path, referrer, timestamp |
| `listing_view` | space recommendation | listing ref, dwell seconds |
| `search_performed` | space recommendation | query text, filters, result count |
| `filter_applied` | space recommendation | filter names and values |
| `shortlist_added` | space recommendation | listing ref |
| `contact_revealed` | enquiry handling | listing ref, channel |
| `enquiry_submitted` | enquiry handling | enquiry ref |

**`search_performed` duplicates the existing `search_queries` table**, and the dataflow review (A-2)
settled how. The Gentle Space marketing site is itself a portal, so its searches should flow through
this same pipeline, after which `search_queries` retires. Until that happens the table carries a
comment stating it covers **only the first-party site with no tenant, session, or consent context** —
otherwise someone will eventually compare its counts against `search_performed` and get a wrong
answer. Two pipelines measuring the same concept with neither aware of the other is the duplication
this review exists to catch.

## 7. Retention and erasure

**The raw zone is not a permanent archive.** Purpose limitation cuts both ways: data kept beyond its
stated purpose is unlawful regardless of consent. Raw events carry a retention window per purpose, and
the ClickHouse raw table is partitioned by date so expiry is a partition drop rather than a
scan-and-delete.

Erasure paths, all driven from the deletion ledger:

| Store | Mechanism |
|---|---|
| GCS raw bucket | not addressable per subject — files are batched and multi-subject. A short lifecycle rule bounds exposure to roughly one batch interval; files are deleted after ingest anyway |
| ClickHouse raw | `DELETE` by subject, or partition drop at retention expiry |
| Postgres curated | suppression then scheduled erase, per datastore §11.1 |
| ClickHouse rollups | crypto-shred or lightweight `DELETE` |
| Consent records | **retained** — they are the evidence that collection was lawful |

Note the asymmetry: erasing consent records would destroy the proof that prior processing was
authorised, so they survive the erasure of the data they authorised, under the Rule 8(3) floor.

## 8. Data model additions

Postgres, in the `context` schema. Full conventions in the data model spec §0.

```sql
CREATE TABLE context.consent_purposes (        -- the fixed catalogue
  code        TEXT PRIMARY KEY,                -- 'site_analytics','space_recommendation','enquiry_handling'
  description TEXT NOT NULL
);

CREATE TABLE context.tenant_portal_config (
  org_id           public.org_ref PRIMARY KEY REFERENCES public.orgs(id),
  ingest_key       TEXT NOT NULL UNIQUE,       -- public identifier, not a secret
  allowed_origins  TEXT[] NOT NULL DEFAULT '{}',
  purposes_offered TEXT[] NOT NULL DEFAULT '{}',
  notice_version   INTEGER NOT NULL DEFAULT 1,
  notice_copy      JSONB NOT NULL DEFAULT '{}',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Immutable. Withdrawal is a new row, never an update.
CREATE TABLE context.consent_records (
  id             UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id         public.org_ref NOT NULL REFERENCES public.orgs(id),
  subject_ref    TEXT NOT NULL,                -- session id, or enquiry id once linked
  purposes       TEXT[] NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('granted','withdrawn')),
  notice_version INTEGER NOT NULL,
  mechanism      TEXT NOT NULL CHECK (mechanism IN ('banner','form','consent_manager')),
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX consent_records_lookup_idx
  ON context.consent_records (org_id, subject_ref, occurred_at DESC);

-- The pseudonymity link from §5.
CREATE TABLE context.session_links (
  org_id      public.org_ref NOT NULL REFERENCES public.orgs(id),
  session_id  TEXT NOT NULL,
  enquiry_id  UUID NOT NULL REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,
  linked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, session_id, enquiry_id)
);
```

`context.deletion_propagations.store` gains `bigquery`.

The consent lookup is on the hot path of every ingested event, so it is cached per
`(org_id, subject_ref)` with a short TTL and invalidated on any new consent record. A withdrawal must
take effect in seconds, not at the next cache expiry.

## 9. Risks

**No new database, but two new dependencies inside ClickHouse.** Choosing the self-hosted path avoids
a ninth system, at the cost of depending on the S3Queue engine and on ClickHouse Keeper (which S3Queue
needs to track processed files). Keeper runs embedded on a single node, so it is configuration rather
than a service — but it is a component that can fail and did not exist before. Nothing product-facing
depends on this path: if ingestion stalls, events queue in Pub/Sub and brokers notice nothing.

**Consent correctness is now a product surface.** A bug in the gate is a compliance breach, not a
defect. It needs the same test rigour as tenant isolation: an event with no consent, with withdrawn
consent, and with consent for a different purpose must each be rejected, proven by test.

**Session clickstream is the highest-risk data in the system.** It is the largest volume, the most
personal, the least necessary to the product working, and the hardest to justify under purpose
limitation. If any part of this gets cut for risk reasons, cut this first — enquiry handling works
without it.

**Broker-side implementation is out of our control.** We can reject events lacking consent, but we
cannot verify the broker actually showed a compliant notice. The contract must place that obligation
on them, and the notice configuration should make the compliant path the easy one.

## 10. Open questions

1. **Consent Manager registration** — DPDP Rule 4 commences 14 Nov 2026 and creates a registered
   Consent Manager role. Does a broker using our consent surface need one, or does our surface
   suffice? Needs a lawyer.
2. **Is `page_view` justifiable at all?** Site analytics is the weakest purpose in the catalogue
   under purpose limitation. It may not survive scrutiny, and the product does not need it.
3. **Retention window per purpose** — how long is defensible for each? Interacts with the Rule 8(3)
   one-year floor in a way the sources do not resolve.
4. **Where the ingestion endpoint runs** — Cloud Run scales to zero and suits a spiky public
   endpoint, but adds a deployment target beyond the two Next.js apps.
5. **Cross-tenant behavioural aggregation** — corridor-level demand signals across brokers would be
   valuable, and would make us a controller for that processing with its own lawful basis. Out of
   scope here; must not be done incidentally.
