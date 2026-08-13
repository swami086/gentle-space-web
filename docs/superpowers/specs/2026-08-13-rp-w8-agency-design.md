# RP-W8 — Agency workspace: multi-account, bulk audit, white-label reports

Date: 2026-08-13  
Status: approved  
Program: [`2026-08-13-rp-program-design.md`](2026-08-13-rp-program-design.md)  
Depends on: W0 (`lib/tenant-config/`, `lib/autonomy/`), `auth-service` RBAC  
Migration range: **190–199**  
Owned paths: `ads-agent/lib/agency/`, `ads-agent/app/(admin)/agency/`

## Problem

Ryze sells an agency tier: manage hundreds of client accounts, run bulk audits across all of them, send AI-generated client reports automatically, and put the whole thing under the agency's brand. `ads-agent` today assumes a single operator inside one org. A CRE brokerage with several offices — or a marketing agency running multiple broker clients — has no way to see across accounts, and no branded artefact to send a client.

## Goals

1. A workspace that spans many client orgs, with health scores and a cross-account view of spend, pipeline and open issues.
2. Bulk audit: run the ads, SEO, GEO and CRO checks across every account in one action and produce a prioritised issue queue.
3. White-label reporting: scheduled, branded reports (logo, colours, sender domain) generated per client and delivered on a cadence.
4. Role separation so an agency operator can act across clients while a client user sees only their own org.

## Non-goals

- Reseller billing, markup/margin control and affiliate programs (decision 9).
- A client-facing login portal — clients receive reports; the existing `lib/portal` consent surface is untouched by this workstream.
- Cross-tenant data blending in the context graph. Aggregates are computed per org and summed for display; no query joins two clients' rows.

## Tenancy model

An agency is an org with a membership edge to each client org. Every read remains RLS-scoped to a single `org_id`; the workspace iterates orgs the operator is entitled to and aggregates in application code. This is deliberately not a widened RLS policy — the existing `cross_tenant_read` capability from S11 is the only sanctioned mechanism, and it is audited per use. A gate test asserts no new query sets `app.current_tenant_id` to more than one value in a single transaction.

## Data model (migrations 190–193)

```sql
CREATE TABLE adsagent.agency_memberships (
  agency_org_id uuid NOT NULL,
  client_org_id uuid NOT NULL,
  relationship  text NOT NULL DEFAULT 'managed'
                CHECK (relationship IN ('managed','readonly')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_org_id, client_org_id)
);

CREATE TABLE adsagent.account_health (
  org_id uuid NOT NULL, computed_at timestamptz NOT NULL DEFAULT now(),
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  components jsonb NOT NULL,      -- per-dimension scores + reasons
  PRIMARY KEY (org_id, computed_at)
);

CREATE TABLE adsagent.report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_org_id uuid NOT NULL, client_org_id uuid NOT NULL,
  cadence text NOT NULL CHECK (cadence IN ('weekly','monthly')),
  recipients text[] NOT NULL, brand jsonb NOT NULL,
  next_run_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','paused'))
);

CREATE TABLE adsagent.generated_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL, schedule_id uuid, period_start date NOT NULL, period_end date NOT NULL,
  artifact_key text NOT NULL, delivered_at timestamptz,
  UNIQUE (schedule_id, period_start, period_end)
);
```

All RLS `FORCE`, leading-edge tenant index (GC6). The `UNIQUE` on `generated_reports` is the idempotency guarantee: a scheduler restart cannot double-send a period.

## Health score

A composite over dimensions the other workstreams already produce: spend pacing against budget, cost per qualified lead versus the account's own trailing baseline, share of proposals left unactioned, open critical SEO/GEO issues, and connection health from `channel_connections`. Each component contributes a bounded sub-score with a stated reason, and the UI always shows the components — a bare number nobody can act on is worse than no number.

## Bulk audit

One action fans out per client org, running each workstream's audit entry point within that org's RLS scope, then collates results into a single prioritised queue sorted by estimated impact. Fan-out is bounded by a concurrency limit and is resumable: a partially completed bulk audit records per-org status so a rerun skips completed orgs.

## White-label reporting

Reports are generated as artifacts (Garage, via `putArtifact`) from a template that takes the brand from `report_schedules.brand`, falling back to the client's `tenant_config.brandKit`. Content: spend and pipeline for the period, qualified-lead trend, what the agents changed and why (drawn from the proposal ledger, so the report is a view of the audit trail rather than a separate narrative), open issues, and next actions. Narrative prose is model-generated but every figure is rendered server-side from queried values, following the evidence-bound pattern in `lib/generative/` — the model never states a number.

Delivery honours **BD2**: this workstream does not add an outbound send library. Reports are generated, stored and surfaced for download or handed to whatever send path exists when BD2 is lifted; `delivered_at` stays null until then. A scheduled report that cannot be delivered is still generated and visible, so the value is available immediately.

## Action kinds registered

| Kind | Default | Notes |
|---|---|---|
| `agency.run_bulk_audit` | auto-eligible, streak 3 | Read-only fan-out, no external writes |
| `agency.generate_report` | auto-eligible, streak 3 | Produces an artifact only |
| `agency.update_report_schedule` | gated, streak 8 | Changes who receives what |

## Interfaces

**Consumes:** `getTenantConfig`, `evaluateAutonomy`, `putArtifact`, each workstream's audit entry point (`auditSite` from W5, `analyseCitability` from W6, `detectFriction` from W7, proposal/performance reads from W1).

**Produces:**

```ts
export function listManagedOrgs(agencyOrgId: string): Promise<ManagedOrg[]>;
export function computeHealth(orgId: string): Promise<HealthScore>;
export function runBulkAudit(agencyOrgId: string): Promise<BulkAuditRun>;
export function generateReport(orgId: string, period: DateRange, brand: BrandKit): Promise<{ artifactKey: string }>;
```

## Admin surface

`app/(admin)/agency/`: an account grid with health, spend, qualified leads and open issues per client; a bulk-audit launcher with a resumable progress view; an issue queue across all clients; and report schedule management with a preview of the branded output.

## Testing

- `tenancy.db.test.ts` — the gate on isolation: aggregation never sets more than one tenant per transaction; a non-member agency reads nothing.
- `health.test.ts` — every component bounded and reasoned; missing input degrades one component rather than the score.
- `bulk-audit.test.ts` — resumability (a rerun skips completed orgs), concurrency bound respected.
- `report.test.ts` — figures rendered from queried values, model output cannot introduce a number; idempotent per period.
- `w8-gate.test.ts` — no outbound send dependency is imported (BD2), and every report's change narrative reconciles with the proposal ledger.
