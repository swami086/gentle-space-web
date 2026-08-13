# RP-W5 — SEO autopilot (compliant subset)

Date: 2026-08-13  
Status: approved  
Program: [`2026-08-13-rp-program-design.md`](2026-08-13-rp-program-design.md)  
Depends on: W0 (`lib/publish/` contract, `lib/autonomy/`, `lib/tenant-config/`)  
Migration range: **170–179**  
Owned paths: `ads-agent/lib/seo/`, `ads-agent/app/(admin)/seo/`

## Problem

Ryze sells an SEO autopilot: technical fixes, hundreds of posts a month, programmatic content, daily rank tracking and large-scale link acquisition. We have no organic surface at all in `ads-agent`. A CRE broker's inbound demand is heavily search-led, so organic is a real gap — but a substantial part of Ryze's advertised mechanism (bought backlinks, PR networks, guest posts, mass content) is what [Google's spam policies](https://developers.google.com/search/docs/essentials/spam-policies) classify as link spam, scaled content abuse and site reputation abuse.

## Goals

1. Continuous technical SEO auditing of tenant sites hosted on `cms-service`, with fixes proposed through the standard autonomy path.
2. Programmatic page generation that is genuinely useful and data-backed: one page per locality / corridor / building type, built from real listings inventory.
3. Editorial content briefs and drafts that a human approves before publication.
4. Rank and impression tracking with alerting, using Search Console data rather than scraped SERPs.

## Non-goals (GC3, non-negotiable)

- Buying, exchanging or otherwise acquiring links for ranking purposes.
- Generating pages at volume whose primary purpose is ranking rather than user value.
- Publishing our content onto third-party host domains to borrow their ranking signals (guest posting, PR placement networks, parasite pages).
- Automated posting to Reddit, Quora, Medium, Wikipedia or any community platform.
- Editing sites we do not host — third-party CMS adapters are out of scope (decision 4).

Where Ryze advertises "500+ backlinks/month", this workstream delivers **earned-link instrumentation** instead: it detects and reports referring domains, and it drafts outreach a human sends. Nothing automates link acquisition.

## Architecture

```text
cms-service pages ──► crawler (internal, respects robots) ──► issue detector
                                                                  │
Search Console API ──► rank/impression store ──► regression detector
                                                                  │
listings inventory ──► programmatic page planner ──► value gate ───┤
                                                                  ▼
                                                    seo.* proposals → autonomy
                                                                  ▼
                                                     lib/publish client → cms-service
```

## Issue detector

Checks run per page and per site: missing or duplicate title/meta, title length, H1 structure, missing schema, broken internal links, orphaned pages, thin pages below the word-count and distinct-fact thresholds, missing canonical, missing alt text, slow LCP from field data, and sitemap/robots inconsistencies. Each issue carries a severity, an explanation, and a machine-applicable fix payload where one exists. Issues without a safe automatic fix are surfaced as tasks, not silently skipped.

## Programmatic pages and the value gate

A generated page may only be published when it passes a **value gate**: it must be backed by at least a configured minimum number of real listings, contain at least the configured number of distinct facts drawn from those listings (price bands, sizes, amenities, transit proximity), and be materially different from every existing page by content similarity. Pages that fail the gate are never published, and a page whose backing inventory later falls below the minimum is automatically unpublished. This is the mechanism that keeps programmatic generation on the correct side of scaled content abuse, and the gate's thresholds live in tenant config (GC2).

## Editorial content

The content agent produces a brief (target query, intent, outline, required facts and sources) and a draft. Drafts are always gated — `seo.publish_article` has `human_opt_in` false by default and no automatic promotion — because published editorial carries reputational risk that a streak counter does not capture. Volume claims are deliberately not matched: the spec targets correctness, not "hundreds of posts a month".

## Rank tracking

Google Search Console API supplies queries, impressions, clicks and average position per page, stored daily. A regression detector flags pages losing position or impressions beyond a threshold and opens an issue with the diff of what changed on that page since the decline began — the CMS page versioning from W7 makes that correlation possible. Alerts go to the existing notification path.

## Data model (migrations 170–173)

```sql
CREATE TABLE adsagent.seo_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  page_id uuid,
  code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical','important','minor')),
  detail jsonb NOT NULL,
  fix_payload jsonb,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','proposed','fixed','dismissed')),
  detected_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE adsagent.seo_rankings (
  org_id uuid NOT NULL, page_id uuid, query text NOT NULL, date date NOT NULL,
  impressions integer NOT NULL, clicks integer NOT NULL, position numeric(5,2) NOT NULL,
  PRIMARY KEY (org_id, page_id, query, date)
);

CREATE TABLE adsagent.seo_page_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL, template text NOT NULL, entity_key text NOT NULL,
  backing_listing_ids uuid[] NOT NULL, value_gate jsonb NOT NULL,
  state text NOT NULL DEFAULT 'planned'
       CHECK (state IN ('planned','published','withheld','unpublished')),
  UNIQUE (org_id, template, entity_key)
);
```

All RLS `FORCE`, leading-edge tenant index (GC6).

## Action kinds registered

| Kind | Default | Notes |
|---|---|---|
| `seo.apply_technical_fix` | gated, streak 10 | Title/meta/schema/alt/canonical/internal-link fixes |
| `seo.publish_programmatic_page` | gated, streak 15 | Requires a passing value gate at evaluate **and** execute time |
| `seo.unpublish_page` | gated, streak 6 | Reversible; used when inventory drops |
| `seo.publish_article` | gated, opt-in only, never auto-promotes | Editorial judgement |

## Interfaces

**Consumes:** `upsertPage`, `patchBlock`, `getPageAudit` (W0 publish client), `evaluateAutonomy`, `getTenantConfig`, listings reads (via the context MCP `read_spaces` path rather than a direct cross-schema query).

**Produces:**

```ts
export function auditSite(orgId: string): Promise<SeoIssue[]>;
export function planProgrammaticPages(orgId: string): Promise<PagePlan[]>;
export function evaluateValueGate(plan: PagePlan, config: CreConfig): { pass: boolean; reasons: string[] };
export function syncSearchConsole(orgId: string, range: DateRange): Promise<{ rows: number }>;
export function detectRankRegressions(orgId: string): Promise<RankRegression[]>;
```

## Testing

- `value-gate.test.ts` — a plan below the listing minimum, below the fact minimum, or too similar to an existing page fails; thresholds come from tenant config, not constants.
- `issue-detector.test.ts` — each check on fixture pages; fixes are idempotent (re-applying changes nothing).
- `rank-regression.test.ts` — regression requires sustained decline, not a one-day dip.
- `unpublish.test.ts` — inventory falling below the minimum produces an unpublish proposal.
- `w5-gate.test.ts` — the compliance gate: no module imports an outreach/link-acquisition client; `seo.publish_article` cannot reach `auto` from any policy state; every publish call passed through `evaluateAutonomy`.
