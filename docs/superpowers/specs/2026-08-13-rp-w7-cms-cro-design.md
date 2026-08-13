# RP-W7 — `cms-service` and the CRO agent

Date: 2026-08-13  
Status: approved  
Program: [`2026-08-13-rp-program-design.md`](2026-08-13-rp-program-design.md)  
Depends on: W0 (publish contract, `lib/autonomy/`, `lib/tenant-config/`)  
Migration range: `cms-service/lib/db/migrations/001+` (own `cms` schema, own sequence)  
Owned paths: `cms-service/` (entire new app)

## Problem

W5 and W6 need somewhere to publish, and Ryze additionally sells a website/CRO autopilot that edits pages, A/B tests them and fixes conversion friction. Our marketing site is our own; brokers have none we control. Adapting to third-party CMSs was considered and rejected (decision 4): four fragile integrations with partial write coverage. Instead we host broker microsites ourselves, which gives agents complete, safe write access and lets pages draw directly on listings data.

## Goals

1. A standalone Next.js service serving multi-tenant broker microsites on custom domains, with versioned pages.
2. A faithful implementation of the W0 publishing contract, authenticated by internal key, tenant-scoped and idempotent.
3. Server-side A/B experiments with sticky assignment and conversion capture tied to the enquiry spine.
4. A CRO agent that detects conversion friction and proposes fixes through the standard autonomy path.

## Non-goals

- A general-purpose website builder or visual page editor. Pages are composed from a fixed block library; freeform HTML authoring is out of scope.
- Third-party CMS adapters (WordPress, Shopify, Webflow, Framer).
- Replacing the existing Gentle Space marketing site or `/spaces` product.
- Ecommerce/checkout flows — CRO here means enquiry conversion, not cart conversion.

## Architecture

```text
                    ┌──────────────────────────────────────────┐
broker domain ─────►│ cms-service (Next.js, own port, schema cms)│
                    │  · page renderer (SSR, no JS required)     │
                    │  · experiment assignment (sticky cookie)   │
                    │  · /internal/* contract API                │
                    └───────────────┬──────────────────────────┘
                                    │ enquiry submit
                                    ▼
                    ads-agent enquiry spine (existing) ──► CRM
                                    ▲
                                    │ upsertPage / patchBlock / createExperiment
                    ads-agent lib/publish client (W0) ──┘
```

Deployment mirrors `auth-service`: own port (3050), own compose service, own schema in the consolidated Postgres, internal-key auth between services.

## Rendering constraints

Pages render server-side and the primary content must be present without client-side JavaScript. This is not a preference: W6's citability analyser and W5's crawler checks both fail a page whose content requires JS, and a CMS that produced such pages would fight its own consumers. Interactivity (galleries, filters) hydrates progressively on top of rendered content.

## Data model (`cms` schema, migrations 001–005)

```sql
CREATE TABLE cms.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL, domain text NOT NULL UNIQUE,
  brand jsonb NOT NULL, locale text NOT NULL DEFAULT 'en-IN',
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','suspended'))
);

CREATE TABLE cms.pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL, site_id uuid NOT NULL, slug text NOT NULL,
  current_version integer NOT NULL DEFAULT 1,
  published boolean NOT NULL DEFAULT false,
  UNIQUE (site_id, slug)
);

CREATE TABLE cms.page_versions (
  page_id uuid NOT NULL, version integer NOT NULL, org_id uuid NOT NULL,
  title text NOT NULL, meta_description text NOT NULL, blocks jsonb NOT NULL,
  author text NOT NULL,                      -- 'agent:seo' | 'agent:cro' | 'user:<id>'
  proposal_id uuid,                          -- links every change to the ledger (GC4)
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, version)
);

CREATE TABLE cms.experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL, page_id uuid NOT NULL, hypothesis text NOT NULL,
  variants jsonb NOT NULL, traffic_split integer[] NOT NULL,
  min_sessions_per_variant integer NOT NULL DEFAULT 500,
  min_days integer NOT NULL DEFAULT 14,
  state text NOT NULL DEFAULT 'running'
        CHECK (state IN ('running','concluded','aborted')),
  winner_variant text
);

CREATE TABLE cms.experiment_events (
  id bigserial PRIMARY KEY, org_id uuid NOT NULL, experiment_id uuid NOT NULL,
  variant text NOT NULL, visitor_hash text NOT NULL,
  event text NOT NULL CHECK (event IN ('view','enquiry')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
```

All tables carry `org_id`, RLS `FORCE`, leading-edge tenant index (GC6). `page_versions.proposal_id` is what makes W5's "what changed on this page since rankings fell" query answerable.

## Contract implementation

`/internal/pages` (upsert), `/internal/pages/:id/blocks` (patch), `/internal/experiments` (create), `/internal/pages/:id/audit` (version history). Each validates the internal key, requires an `Idempotency-Key` and the `proposalId` and `author` fields of W0's `PublishContext`, resolves `org_id` from the body, and writes a new `page_versions` row rather than mutating in place — rollback is republishing a prior version, which is why a failed publish is always recoverable.

## Experiments

Assignment is server-side and sticky per visitor hash, so a returning visitor sees a stable variant and search crawlers always receive the control variant — serving experiment variants to crawlers would be indistinguishable from cloaking. Conversion is an `enquiry` event, joined from the ads-agent enquiry spine by experiment and variant. The stopping rule mirrors W3: conclude only when every variant reaches `min_sessions_per_variant` and `min_days` have elapsed; ties within a 5% band conclude with no winner.

## CRO agent

Detects friction from the funnel: pages with traffic and no enquiries, forms abandoned mid-completion, above-the-fold content missing the primary action, slow LCP on mobile field data, and message mismatch between an ad's promise and its landing page (joined through the creative variant's `finalUrl`). Each detection proposes a concrete change — a block reorder, a shortened form, a clarified heading — as an experiment rather than a direct edit, so a CRO change is measured, not asserted.

## Action kinds registered

| Kind | Default | Notes |
|---|---|---|
| `cms.page_upsert` | gated, streak 10 | Content create/update |
| `cms.block_patch` | gated, streak 12 | Targeted edit to a live page |
| `cms.experiment_create` | gated, streak 8 | Starts a test, does not change control |
| `cms.publish_version` | gated, streak 10 | Promotes a version to live |
| `cms.rollback_version` | auto-eligible, streak 3 | Restores a prior version; strictly recovery |

## Interfaces

**Consumes:** internal-key auth pattern, ads-agent enquiry spine (conversion events), `getTenantConfig` for brand kit.

**Produces (the contract W5/W6 already code against):** `POST /internal/pages`, `PATCH /internal/pages/:id/blocks`, `POST /internal/experiments`, `GET /internal/pages/:id/audit`, plus:

```ts
export function assignVariant(experimentId: string, visitorHash: string): string;
export function concludeExperiment(orgId: string, experimentId: string): Promise<ExperimentOutcome>;
export function detectFriction(orgId: string, siteId: string): Promise<FrictionSignal[]>;
```

## Error handling

A publish that fails validation leaves the previous version live and returns the validation detail; a partially written version row is impossible because version insertion and pointer update happen in one transaction. Domain misconfiguration suspends only that site. If the ads-agent enquiry spine is unreachable, enquiry submissions are persisted locally and replayed — a lead is never lost to a transient inter-service failure.

## Testing

- `contract.test.ts` — every contract endpoint against the W0 client's expectations, including idempotency replay returning the original version.
- `versioning.db.test.ts` — rollback restores exactly; concurrent upserts serialise without gaps.
- `assignment.test.ts` — sticky per visitor, split honoured over a large sample, crawler user agents always receive control.
- `render.test.ts` — primary content present with JavaScript disabled.
- `enquiry-replay.test.ts` — enquiries survive an ads-agent outage and replay exactly once.
- `w7-gate.test.ts` — no `/internal/*` write succeeds without the internal key; every accepted write carries a `proposal_id`, proving it came through the autonomy path (GC1, GC4).
