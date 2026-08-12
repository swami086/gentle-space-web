# S7 — Attribution and Per-Space Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-corridor cost a real measured figure with a named residual — spend that belongs to no corridor and enquiries that belong to no corridor are reported as their own numbers, never spread across corridors to make the table look complete.

**Architecture:** Corridors become a first-class Postgres entity (`public.corridors`) with a listing mapping and a campaign foreign key, so spend and enquiries finally share a join key. The rollup arithmetic runs against the ClickHouse mirror, because the join is analytical and both facts live there. The result is projected back into the `derived` quarantine schema for the dashboard to read, tagged with its own freshness and with `authority: "derived"` so it can never become the sole justification for a proposal. The honesty property is enforced by a conservation invariant that throws, plus a database `CHECK` that refuses to store a cost-per-enquiry for a corridor with no enquiries.

**Tech Stack:** PostgreSQL 18 (schemas `public`, `listings`, `adsagent`, `derived`), ClickHouse (analytical mirror from S6), TypeScript, Next.js, Vitest.

## Preconditions

This plan does not start until all three have passed their gates.

- **S3 (release gate)** — `docs/superpowers/plans/2026-08-12-s1-s3-foundation.md`. Provides `ads-agent/lib/db/scope-sql.ts` exporting `type Scope` and `scopeClause(scope, column?)`, the SQL helpers `public.set_tenant(uuid)` / `public.current_tenant()`, the five schemas and their roles, `public.lifecycle_state`, and `public.org_ref`. Also provides the consolidated PG18 instance in which `adsagent` code can read `listings` tables — the `GRANT` that closes backend spec D2.
- **S5** — `docs/superpowers/plans/2026-08-12-s4-s5-enquiry-spine.md`. Provides `adsagent.enquiries` (with `listing_url`, `listing_id`, `corridor_id`, `first_seen_at`, `lifecycle`) and `adsagent.contacts`. **Attribution joins enquiries to spend; without the enquiry spine there is no numerator and this plan has nothing to measure.**
- **S6 / S6a** — `docs/superpowers/plans/2026-08-12-s6-s6a-clickhouse-portal-ingestion.md`. Provides the ClickHouse mirror, the CDC feed, and `enquiry_fact` (data model §7). Provides the `derived` quarantine schema convention that Task 1 migration 074 populates.

`Scope` is `{ kind: "platform"; orgId: string } | { kind: "org"; orgId: string }` (tenancy spec §1). Import it; never redeclare it.

## Global Constraints

Every task inherits these. Copy them verbatim into every reviewer dispatch.

- **Every SQL object is schema-qualified.** The deployed role has `search_path = "ag_catalog, $user, public"`; an unqualified `CREATE TABLE` lands inside the AGE extension's schema.
- **Every schema change is a numbered up/down migration containing an explicit `ALTER`.** `ads-agent/lib/db/migrate.ts` re-runs `schema.sql`, and `CREATE TABLE IF NOT EXISTS` is a no-op against an existing table, so anything expressed inside a `CREATE TABLE` body never reaches a provisioned database.
- **`id UUID PRIMARY KEY DEFAULT uuidv7()`** on every new table (native in PostgreSQL 18), **`org_id UUID NOT NULL`** on every domain table, every index leads with `org_id`, and `TIMESTAMPTZ` never `TIMESTAMP`.
- **`set_config('app.current_tenant_id', $1, true)`** — the third argument is mandatory. Both apps use `pg.Pool`; without transaction scoping the setting persists on the connection and the next request inherits the previous tenant.
- **`ENABLE` *and* `FORCE ROW LEVEL SECURITY`** on every tenant table. Table owners ignore RLS unless it is forced.
- **Policies carry `WITH CHECK` as well as `USING`.** `USING` alone permits writing rows under another tenant's `org_id`.
- **Suppression columns, never `DELETE`.** DPDP Rule 8(3) imposes a one-year retention floor even after account deletion; erasure is suppression followed by scheduled hard delete.
- **Wrong tenant returns `404`, never `403`.** A 403 confirms the row exists.
- **`Scope` is the first and required parameter** of every data-layer function, so a missed call site is a TypeScript compile error rather than a silent full-table read.
- **No new dependencies** without asking.
- Tests are Vitest, colocated as `*.test.ts`, run with `npx vitest run` from the owning app directory.

### Constraints this plan's own specs add

- **No corridor figure absorbs an unattributable figure.** `sum(corridors.spendInr) + residual.unattributedSpendInr === totals.spendInr`, and the same for enquiry counts. Violating it throws `AttributionConservationError`. This is the S7 gate expressed as an assertion.
- **`costPerEnquiryInr` is `null`, never `0`, when the enquiry count is zero.** Enforced in TypeScript and again by a database `CHECK` on `derived.corridor_attribution_daily`.
- **Analytical reads hit ClickHouse; reference and mapping reads hit Postgres.** Named per query in Task 6 and Task 7. Cross-system joins are forbidden — datastore spec §3: "Keep analytical tables together in ClickHouse and join them there."
- **Anything projected back into Postgres from ClickHouse lands in the `derived` quarantine schema**, is truncatable and rebuildable, is never the input to another derivation, and may never be the sole justification for a proposal. Enforced by `assertNotSoleDerivedJustification` (Task 3).
- **Per-space cost is an allocation, not a measurement** (backend spec BD4). Its type carries `isEstimate: true` as a literal and a named `basis`, so a measurement cannot be passed where an estimate is expected or vice versa.
- **Migration numbers 070–079 only.** This plan uses 070–074. No task may claim a number outside that range.

---

## Decisions this plan makes so the implementer does not have to

Both were left open by the specs. They are settled here.

**Backend spec §5 Q3 — corridor vocabulary.** Listing areas are free text from scrapers (`lib/listings/normalize.ts`). Migration 070 seeds a fixed vocabulary of 17 Bangalore corridors with aliases; migration 071 maps listings to corridors by exact display-name match at `confidence = 1.0` and alias substring match at `confidence = 0.7`. **A listing that matches nothing gets no row.** There is no `other` or `unknown` corridor, because a catch-all bucket is precisely how unattributable spend acquires a plausible home. Unmapped listings surface as `residual.unattributedEnquiryCount`.

**Backend spec §5 Q5 — allocation rule for D5.** **Equal split** across the corridor's mapped listings. Weighting by enquiry volume is circular when enquiries are the metric being computed. The rule is recorded in the payload as `basis: "equal_split"` so it is legible and swappable, and every returned row carries `isEstimate: true`.

**Attribution window, and late conversions.** Neither spec states a window; backend spec D6 requires one ("a derived metric with a defined window"). Settled:

- A window is a pair of **inclusive calendar dates in Asia/Kolkata**. IST is UTC+05:30 with no daylight saving, so the boundary is computable without a timezone library or a new dependency.
- An enquiry belongs to the window containing its `first_seen_at`; spend belongs to the window containing `captured_at`. Both converted to IST calendar dates first.
- A window is **`open` until `ATTRIBUTION_CLOSE_DAYS = 14` days after its end date, then `closed`.** Fourteen days is chosen because both the enquiry loop and Google Ads conversion import settle well inside two weeks; the constant lives in one place with that rationale beside it.
- **A conversion attributed after the window closes does not change the closed figures.** The stored row is frozen. The difference between the current enquiry count and the frozen one is reported as `lateEnquiryCount` on the closed window. It is never folded into `costPerEnquiryInr`, because silently re-deriving a historical cost is the same failure as inventing one.

---

## File structure

**Created — Postgres migrations** (`ads-agent/lib/db/migrations/`, each with a matching `.down.sql`):

| File | Responsibility |
|---|---|
| `070_corridors.up.sql` | `public.corridors` + seeded vocabulary + hierarchy edges (D1) |
| `071_listing_corridors.up.sql` | `listings.listing_corridors` + alias mapping with confidence (D1, D2) |
| `072_campaign_corridor_id.up.sql` | `adsagent.campaigns.corridor_id` + backfill from the dead TEXT column (BD7) |
| `073_enquiry_corridor_fk.up.sql` | FK constraints on `adsagent.enquiries.corridor_id` / `.listing_id` (D3) |
| `074_derived_attribution.up.sql` | `derived.corridor_attribution_daily`, `derived.attribution_reconciliation`, RLS, grants, quarantine comments (D4, D6) |

**Created — TypeScript** (`ads-agent/`):

| File | Responsibility |
|---|---|
| `lib/attribution/window.ts` | IST calendar-date arithmetic, `open`/`closed` state, in-window vs late classification |
| `lib/attribution/freshness.ts` | CDC lag, staleness threshold, `StaleAttributionError` |
| `lib/attribution/quarantine.ts` | `authority` tagging and `assertNotSoleDerivedJustification` |
| `lib/attribution/org-scope.ts` | `orgScopeFromSession` — one place that turns a session into an org `Scope` |
| `lib/attribution/allocation.ts` | Per-space equal-split estimate (D5) |
| `lib/attribution/reconcile.ts` | The honesty core: rollup, residual, conservation assertion, frozen-window merge (D6) |
| `lib/attribution/listing-url.ts` | `listingSlugFromUrl` — resolves a captured URL to a listing slug (D3) |
| `lib/attribution/analytical-source.ts` | The single ClickHouse seam: SQL text plus injected query function |
| `lib/attribution/rebuild.ts` | The job: read the mirror, reconcile, write the quarantine |
| `lib/db/corridors.ts` | Scope-first Postgres reads of corridors and listing mappings, enquiry resolution |
| `lib/db/attribution.ts` | Scope-first reads and upserts of the `derived` tables |
| `lib/openui/tool-scope.ts` | Org scope for tool surfaces |
| `clickhouse/attribution/attribution.sql` | `spend_fact` DDL and its row policy |

**Modified:**

| File | Change |
|---|---|
| `lib/db/dashboard.ts` | Adds `getCorridorCosts`; `OverviewStats` gains `costPerEnquiryInr` and `attributionIsStale`; `listCampaignsWithLatestCpl` reads the corridor's display name via join |
| `app/(admin)/page.tsx` | Renders cost per enquiry and the residual line |
| `lib/openui/analytics-tools.ts` | Adds `get_corridor_attribution` and `get_per_space_cost_estimate` |

**Deliberately not modified**, and why — from the import graph:

- `ads-agent/components/SpendCplChart.tsx` and `ads-agent/lib/decision-engine/reports-chat.ts` import from `db/dashboard` and `openui/analytics-tools` respectively. Both changes are **additive exports**; neither consumer's call sites change.
- `ads-agent/mcp/app-data-mcp-server/index.ts` registers three named tools from `analyticsToolProvider`. The two new tools are deliberately **not** registered there: that server is the read surface Hermes reaches, and exposing an attribution figure to an agent belongs with the MCP context server at S9, under the freshness rule.
- `ads-agent/lib/decision-engine/cycle.ts` — the autonomous decision cycle and the highest-blast-radius file in the repo. S7 gives it nothing to consume yet. Wiring `assertNotSoleDerivedJustification` into pre-flight checks is **S11's** job (backend spec E2). No task in this plan opens that file.

---

## Parallel execution model

`superpowers:subagent-driven-development` lists parallel implementation subagents sharing a working tree under **Never**, so parallelism here means **one git worktree and branch per agent** (`best-of-n-runner` subagent type), with an explicit fan-in merge task closing each wave.

**The ceiling is 8; this plan never reaches it, and padding it to 8 would be dishonest.** S7 touches 13 new TypeScript files, 10 migration files, and 3 existing files. The reconciliation core is a single dependency spine — window types feed reconciliation and the ClickHouse seam, both feed the rebuild job, and the rebuild job feeds both display surfaces — so the graph is narrow by construction. Maximum honest width is 4.

| Wave | Tasks | Width | Why that width |
|---|---|---|---|
| W1 | 1, 2, 3, 4 | **4** | Four disjoint file sets with zero shared imports. Task 1 writes only `.sql`; Tasks 2, 3, 4 each write pure-TypeScript modules importing nothing from each other. Proven below. |
| W2 | 5, 6, 7 | **3** | All three consume Wave 1 outputs and nothing from each other. Tasks 5 and 6 both import `window.ts` (read-only, unmodified); Task 7 imports only migration 070–072 tables. |
| W3 | 8 | **1** | Fan-in. `rebuild.ts` imports from Tasks 2, 3, 5, 6 and 7 simultaneously; there is no second task that does not depend on it. |
| W4 | 9, 10 | **2** | Two display surfaces, disjoint files, both depending only on Task 8. Proven below. |
| W5 | 11 | **1** | Fan-in merge, the fabrication gate, and adversarial review of the whole branch. |

**Disjointness proof — Wave 1.** No file appears twice.

| Task | Files it touches |
|---|---|
| 1 | `lib/db/migrations/070_*.sql`, `071_*.sql`, `072_*.sql`, `073_*.sql`, `074_*.sql` (up and down), `lib/db/migrations/attribution-migrations.test.ts` |
| 2 | `lib/attribution/window.ts`, `lib/attribution/window.test.ts` |
| 3 | `lib/attribution/freshness.ts`, `freshness.test.ts`, `lib/attribution/quarantine.ts`, `quarantine.test.ts`, `lib/attribution/org-scope.ts`, `org-scope.test.ts` |
| 4 | `lib/attribution/allocation.ts`, `lib/attribution/allocation.test.ts` |

**Migration numbers:** Task 1 is the only task in the entire plan that creates a migration, so no two tasks can collide on a number. 070–074 are claimed; 075–079 stay free for a later correction inside this range.

**Disjointness proof — Wave 2.**

| Task | Files it touches |
|---|---|
| 5 | `lib/attribution/reconcile.ts`, `reconcile.test.ts` |
| 6 | `lib/attribution/analytical-source.ts`, `analytical-source.test.ts`, `clickhouse/attribution/attribution.sql` |
| 7 | `lib/attribution/listing-url.ts`, `listing-url.test.ts`, `lib/db/corridors.ts`, `corridors.test.ts` |

**Disjointness proof — Wave 4.**

| Task | Files it touches |
|---|---|
| 9 | `lib/db/dashboard.ts`, `lib/db/dashboard.test.ts`, `app/(admin)/page.tsx` |
| 10 | `lib/openui/analytics-tools.ts`, `lib/openui/analytics-tools.test.ts`, `lib/openui/tool-scope.ts`, `tool-scope.test.ts` |

Task 10 imports `lib/db/attribution.ts` (Task 8) directly rather than routing through `dashboard.ts`, which is what keeps these two in the same wave.

---

# Wave 1

## Task 1: The attribution schema

**Files:**
- Create: `ads-agent/lib/db/migrations/070_corridors.up.sql`, `070_corridors.down.sql`
- Create: `ads-agent/lib/db/migrations/071_listing_corridors.up.sql`, `071_listing_corridors.down.sql`
- Create: `ads-agent/lib/db/migrations/072_campaign_corridor_id.up.sql`, `072_campaign_corridor_id.down.sql`
- Create: `ads-agent/lib/db/migrations/073_enquiry_corridor_fk.up.sql`, `073_enquiry_corridor_fk.down.sql`
- Create: `ads-agent/lib/db/migrations/074_derived_attribution.up.sql`, `074_derived_attribution.down.sql`
- Test: `ads-agent/lib/db/migrations/attribution-migrations.test.ts`

**Skills:** `postgres-pro`, `database-designer`
**Model:** `composer-2.5-fast` — every statement is written out below; this is transcription plus one `psql` verification.

**Interfaces:**
- Consumes: `public.orgs(id)`, `public.org_ref`, `listings.listings(id, slug, area, org_id)`, `adsagent.campaigns(corridor TEXT)`, `adsagent.enquiries(corridor_id, listing_id)` from S3/S5. The `derived` schema and `derived_rw` role from S3.
- Produces: `public.corridors(id, slug, display_name, city, parent_id, aliases, created_at)`; `listings.listing_corridors(listing_id, corridor_id, confidence)`; `adsagent.campaigns.corridor_id`; `derived.corridor_attribution_daily`; `derived.attribution_reconciliation`. Tasks 7, 8, 9 and 10 query these by exactly these names.

**Context:** `adsagent.campaigns.corridor` is a dead TEXT column — its only code reference is a comment in `lib/connectors/twenty.ts:18` (backend spec BD7). Campaign names follow `${corridor} — ${platform} — ${date}`, so the TEXT value is recoverable and worth backfilling from. The TEXT column is **not** dropped here: `lib/db/dashboard.ts:81` selects `c.corridor`, and Task 9 repoints that read. Dropping the column is a later cleanup, outside S7.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/db/migrations/attribution-migrations.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = [
  "070_corridors",
  "071_listing_corridors",
  "072_campaign_corridor_id",
  "073_enquiry_corridor_fk",
  "074_derived_attribution",
];

function read(name: string, dir: "up" | "down"): string {
  return readFileSync(join(__dirname, `${name}.${dir}.sql`), "utf8");
}

describe("attribution migrations exist in pairs", () => {
  it.each(MIGRATIONS)("%s has an up and a down", (name) => {
    const files = readdirSync(__dirname);
    expect(files).toContain(`${name}.up.sql`);
    expect(files).toContain(`${name}.down.sql`);
  });

  it("claims only migration numbers 070-079", () => {
    for (const name of MIGRATIONS) {
      const n = Number(name.slice(0, 3));
      expect(n).toBeGreaterThanOrEqual(70);
      expect(n).toBeLessThanOrEqual(79);
    }
  });
});

describe("attribution migrations obey the global constraints", () => {
  it.each(MIGRATIONS)("%s schema-qualifies every CREATE TABLE", (name) => {
    // An unqualified CREATE TABLE lands inside the AGE extension's schema.
    const unqualified = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?!\w+\.)/i;
    expect(read(name, "up")).not.toMatch(unqualified);
  });

  it.each(MIGRATIONS)("%s never uses bare TIMESTAMP", (name) => {
    expect(read(name, "up")).not.toMatch(/\bTIMESTAMP\b(?!TZ)/i);
  });

  it.each(MIGRATIONS)("%s expresses schema changes as ALTER, not inside CREATE TABLE bodies", (name) => {
    const sql = read(name, "up");
    // Every migration that touches a pre-existing table must say ALTER.
    const touchesExisting = /adsagent\.(campaigns|enquiries)/i.test(sql);
    if (touchesExisting) expect(sql).toMatch(/ALTER\s+TABLE/i);
  });

  it("074 forces RLS with both USING and WITH CHECK on both derived tables", () => {
    const sql = read("074_derived_attribution", "up");
    for (const table of ["derived.corridor_attribution_daily", "derived.attribution_reconciliation"]) {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE ${table} FORCE  ROW LEVEL SECURITY`);
    }
    expect(sql.match(/USING\s+\(org_id = public\.current_tenant\(\)\)/g)).toHaveLength(2);
    expect(sql.match(/WITH CHECK \(org_id = public\.current_tenant\(\)\)/g)).toHaveLength(2);
  });

  it("074 refuses to store a cost per enquiry for a corridor with no enquiries", () => {
    // This CHECK is the S7 gate in the database: a fabricated cost cannot be inserted.
    expect(read("074_derived_attribution", "up")).toContain(
      "CHECK ((enquiry_count = 0) = (cost_per_enquiry_inr IS NULL))",
    );
  });

  it("074 uses uuidv7 and org_id-leading indexes", () => {
    const sql = read("074_derived_attribution", "up");
    expect(sql).toContain("DEFAULT uuidv7()");
    expect(sql).toMatch(/CREATE INDEX[\s\S]*?\(org_id/);
  });

  it("070 seeds a vocabulary with no catch-all bucket", () => {
    // A catch-all corridor is how unattributable spend acquires a plausible home.
    const sql = read("070_corridors", "up");
    expect(sql).toMatch(/INSERT INTO public\.corridors/i);
    expect(sql).not.toMatch(/'(other|unknown|misc|uncategorised|uncategorized)'/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/migrations/attribution-migrations.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open '.../070_corridors.up.sql'`.

- [ ] **Step 3: Write migration 070 — corridors as a real entity (D1)**

```sql
-- ads-agent/lib/db/migrations/070_corridors.up.sql
-- Reference data shared across tenants: deliberately NOT org_id-scoped and therefore
-- not RLS-protected (data model §4). `aliases` is what makes lexical matching work.
BEGIN;

CREATE TABLE IF NOT EXISTS public.corridors (
  id           UUID PRIMARY KEY DEFAULT uuidv7(),
  slug         TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  city         TEXT NOT NULL DEFAULT 'Bangalore',
  parent_id    UUID REFERENCES public.corridors(id),
  aliases      TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS corridors_city_slug_idx ON public.corridors (city, slug);

-- Parents first, so the child inserts can resolve parent_id by slug.
INSERT INTO public.corridors (slug, display_name, aliases) VALUES
  ('outer-ring-road', 'Outer Ring Road', ARRAY['ORR','Outer Ring Rd'])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.corridors (slug, display_name, aliases) VALUES
  ('hsr-layout',      'HSR Layout',      ARRAY['HSR','Hosur Sarjapur Road','HSR Sector']),
  ('koramangala',     'Koramangala',     ARRAY['Koramangla','KRMNGLA']),
  ('indiranagar',     'Indiranagar',     ARRAY['Indira Nagar']),
  ('whitefield',      'Whitefield',      ARRAY['ITPL','Whitefield Main Road']),
  ('electronic-city', 'Electronic City', ARRAY['E City','Electronics City','Ecity']),
  ('cbd-mg-road',     'CBD - MG Road',   ARRAY['MG Road','Mahatma Gandhi Road','Central Business District','CBD']),
  ('jp-nagar',        'JP Nagar',        ARRAY['Jayaprakash Narayan Nagar','J P Nagar']),
  ('jayanagar',       'Jayanagar',       ARRAY['Jaya Nagar']),
  ('sarjapur-road',   'Sarjapur Road',   ARRAY['Sarjapura Road','Sarjapur Main Road']),
  ('hebbal',          'Hebbal',          ARRAY['Hebbal Kempapura']),
  ('yeshwanthpur',    'Yeshwanthpur',    ARRAY['Yeshwantpur','Yashwantpur']),
  ('banashankari',    'Banashankari',    ARRAY['BSK']),
  ('domlur',          'Domlur',          ARRAY['Domlur Layout']),
  ('rajajinagar',     'Rajajinagar',     ARRAY['Rajaji Nagar']),
  ('kalyan-nagar',    'Kalyan Nagar',    ARRAY['Kalyannagar','HRBR Layout'])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.corridors (slug, display_name, parent_id, aliases)
SELECT v.slug, v.display_name, p.id, v.aliases
  FROM (VALUES
    ('orr-bellandur',    'Outer Ring Road - Bellandur',    ARRAY['Bellandur','ORR Bellandur']),
    ('orr-marathahalli', 'Outer Ring Road - Marathahalli', ARRAY['Marathahalli','Marathalli','ORR Marathahalli'])
  ) AS v(slug, display_name, aliases)
  CROSS JOIN (SELECT id FROM public.corridors WHERE slug = 'outer-ring-road') p
ON CONFLICT (slug) DO NOTHING;

COMMENT ON TABLE public.corridors IS
  'Controlled corridor vocabulary. Shared reference data, not tenant-scoped. There is deliberately no catch-all corridor: unmatched listings and campaigns are counted as residual, never bucketed.';

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/070_corridors.down.sql
BEGIN;
DROP INDEX IF EXISTS public.corridors_city_slug_idx;
DROP TABLE IF EXISTS public.corridors;
COMMIT;
```

- [ ] **Step 4: Write migration 071 — listing to corridor mapping (D1, D2)**

```sql
-- ads-agent/lib/db/migrations/071_listing_corridors.up.sql
BEGIN;

CREATE TABLE IF NOT EXISTS listings.listing_corridors (
  listing_id   UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  corridor_id  UUID NOT NULL REFERENCES public.corridors(id),
  confidence   NUMERIC(3,2) NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  PRIMARY KEY (listing_id, corridor_id)
);

CREATE INDEX IF NOT EXISTS listing_corridors_corridor_idx
  ON listings.listing_corridors (corridor_id, listing_id);

-- Exact display-name match: highest confidence.
INSERT INTO listings.listing_corridors (listing_id, corridor_id, confidence)
SELECT l.id, c.id, 1.00
  FROM listings.listings l
  JOIN public.corridors c
    ON lower(btrim(l.area)) = lower(c.display_name)
ON CONFLICT (listing_id, corridor_id) DO NOTHING;

-- Alias substring match: lower confidence, recorded as such rather than hidden.
INSERT INTO listings.listing_corridors (listing_id, corridor_id, confidence)
SELECT l.id, c.id, 0.70
  FROM listings.listings l
  JOIN public.corridors c
    ON EXISTS (
         SELECT 1 FROM unnest(c.aliases) AS a
          WHERE l.area <> '' AND lower(l.area) LIKE '%' || lower(a) || '%'
       )
ON CONFLICT (listing_id, corridor_id) DO NOTHING;

COMMENT ON COLUMN listings.listing_corridors.confidence IS
  '1.0 exact display-name match, 0.7 alias substring match. A listing whose area matches nothing gets no row and is counted as residual.';

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/071_listing_corridors.down.sql
BEGIN;
DROP INDEX IF EXISTS listings.listing_corridors_corridor_idx;
DROP TABLE IF EXISTS listings.listing_corridors;
COMMIT;
```

- [ ] **Step 5: Write migration 072 — campaign corridor foreign key (BD7)**

```sql
-- ads-agent/lib/db/migrations/072_campaign_corridor_id.up.sql
-- adsagent.campaigns.corridor is dead TEXT (backend spec BD7). Add the real key and
-- backfill from the free text. The TEXT column stays: lib/db/dashboard.ts still selects
-- it, and its removal is a separate cleanup outside S7.
BEGIN;

ALTER TABLE adsagent.campaigns
  ADD COLUMN IF NOT EXISTS corridor_id UUID REFERENCES public.corridors(id);

CREATE INDEX IF NOT EXISTS campaigns_org_corridor_idx
  ON adsagent.campaigns (org_id, corridor_id);

UPDATE adsagent.campaigns ca
   SET corridor_id = c.id
  FROM public.corridors c
 WHERE ca.corridor_id IS NULL
   AND ca.corridor IS NOT NULL
   AND lower(btrim(ca.corridor)) IN (lower(c.display_name), lower(c.slug));

UPDATE adsagent.campaigns ca
   SET corridor_id = c.id
  FROM public.corridors c
 WHERE ca.corridor_id IS NULL
   AND ca.corridor IS NOT NULL
   AND EXISTS (
         SELECT 1 FROM unnest(c.aliases) AS a
          WHERE lower(ca.corridor) LIKE '%' || lower(a) || '%'
       );

COMMENT ON COLUMN adsagent.campaigns.corridor IS
  'Legacy free-text corridor. Superseded by corridor_id (migration 072). Read for display only until S7 Task 9 repoints dashboard.ts; do not write.';

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/072_campaign_corridor_id.down.sql
BEGIN;
DROP INDEX IF EXISTS adsagent.campaigns_org_corridor_idx;
ALTER TABLE adsagent.campaigns DROP COLUMN IF EXISTS corridor_id;
COMMIT;
```

- [ ] **Step 6: Write migration 073 — enquiry resolution keys (D3)**

```sql
-- ads-agent/lib/db/migrations/073_enquiry_corridor_fk.up.sql
-- Data model §3 declares adsagent.enquiries.corridor_id REFERENCES public.corridors(id),
-- but §4 creates public.corridors and the migration table orders the enquiry spine (016)
-- BEFORE corridors (017). S5 therefore cannot have created that FK. This migration adds it,
-- idempotently, and is the resolution of that ordering contradiction.
BEGIN;

ALTER TABLE adsagent.enquiries ADD COLUMN IF NOT EXISTS corridor_id UUID;
ALTER TABLE adsagent.enquiries ADD COLUMN IF NOT EXISTS listing_id  UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_corridor_id_fkey'
  ) THEN
    ALTER TABLE adsagent.enquiries
      ADD CONSTRAINT enquiries_corridor_id_fkey
      FOREIGN KEY (corridor_id) REFERENCES public.corridors(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_listing_id_fkey'
  ) THEN
    ALTER TABLE adsagent.enquiries
      ADD CONSTRAINT enquiries_listing_id_fkey
      FOREIGN KEY (listing_id) REFERENCES listings.listings(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS enquiries_org_corridor_seen_idx
  ON adsagent.enquiries (org_id, corridor_id, first_seen_at DESC)
  WHERE lifecycle = 'active';

-- Enquiries whose listing_url has not yet been resolved: the work queue for
-- resolveEnquiryListings (Task 7), and the source of the unresolved count.
CREATE INDEX IF NOT EXISTS enquiries_unresolved_listing_idx
  ON adsagent.enquiries (org_id, first_seen_at)
  WHERE listing_id IS NULL AND lifecycle = 'active';

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/073_enquiry_corridor_fk.down.sql
-- Drops only the constraints and indexes this migration added. The columns belong to S5
-- and are left in place.
BEGIN;
DROP INDEX IF EXISTS adsagent.enquiries_unresolved_listing_idx;
DROP INDEX IF EXISTS adsagent.enquiries_org_corridor_seen_idx;
ALTER TABLE adsagent.enquiries DROP CONSTRAINT IF EXISTS enquiries_listing_id_fkey;
ALTER TABLE adsagent.enquiries DROP CONSTRAINT IF EXISTS enquiries_corridor_id_fkey;
COMMIT;
```

- [ ] **Step 7: Write migration 074 — the derived quarantine tables (D4, D6)**

```sql
-- ads-agent/lib/db/migrations/074_derived_attribution.up.sql
-- The derived schema is a quarantine (data model §0, dataflow review A-5): truncatable,
-- rebuildable, never the input to another derivation, and never the sole justification
-- for a proposal. These two tables are projections of a ClickHouse rollup.
BEGIN;

CREATE TABLE IF NOT EXISTS derived.corridor_attribution_daily (
  id                   UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id               public.org_ref NOT NULL REFERENCES public.orgs(id),
  -- NULL corridor_id is the named unattributed bucket. It is a row, not a hidden remainder.
  corridor_id          UUID REFERENCES public.corridors(id),
  window_start         DATE NOT NULL,
  window_end           DATE NOT NULL,
  window_state         TEXT NOT NULL CHECK (window_state IN ('open','closed')),
  spend_inr            NUMERIC(18,4) NOT NULL CHECK (spend_inr >= 0),
  enquiry_count        INTEGER       NOT NULL CHECK (enquiry_count >= 0),
  cost_per_enquiry_inr NUMERIC(18,4),
  late_enquiry_count   INTEGER       NOT NULL DEFAULT 0 CHECK (late_enquiry_count >= 0),
  computed_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  source_watermark     TIMESTAMPTZ   NOT NULL,
  cdc_lag_seconds      INTEGER       NOT NULL CHECK (cdc_lag_seconds >= 0),
  CONSTRAINT corridor_attribution_window_ordered CHECK (window_end >= window_start),
  -- The S7 gate, in the database. A corridor with no enquiries has no cost per enquiry;
  -- a corridor with enquiries must have one. Neither can be fabricated past this line.
  CONSTRAINT corridor_attribution_cost_is_real
    CHECK ((enquiry_count = 0) = (cost_per_enquiry_inr IS NULL)),
  -- NULLS NOT DISTINCT (PostgreSQL 15+) so the unattributed bucket is deduplicated too.
  CONSTRAINT corridor_attribution_unique
    UNIQUE NULLS NOT DISTINCT (org_id, corridor_id, window_start, window_end)
);

CREATE INDEX IF NOT EXISTS corridor_attribution_org_window_idx
  ON derived.corridor_attribution_daily (org_id, window_start DESC, window_end DESC);

CREATE TABLE IF NOT EXISTS derived.attribution_reconciliation (
  id                            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id                        public.org_ref NOT NULL REFERENCES public.orgs(id),
  window_start                  DATE NOT NULL,
  window_end                    DATE NOT NULL,
  window_state                  TEXT NOT NULL CHECK (window_state IN ('open','closed')),
  total_spend_inr               NUMERIC(18,4) NOT NULL CHECK (total_spend_inr >= 0),
  total_enquiry_count           INTEGER       NOT NULL CHECK (total_enquiry_count >= 0),
  unattributed_spend_inr        NUMERIC(18,4) NOT NULL CHECK (unattributed_spend_inr >= 0),
  unattributed_enquiry_count    INTEGER       NOT NULL CHECK (unattributed_enquiry_count >= 0),
  spend_without_enquiries_inr   NUMERIC(18,4) NOT NULL CHECK (spend_without_enquiries_inr >= 0),
  enquiries_without_spend_count INTEGER       NOT NULL CHECK (enquiries_without_spend_count >= 0),
  late_enquiry_count            INTEGER       NOT NULL DEFAULT 0 CHECK (late_enquiry_count >= 0),
  computed_at                   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  source_watermark              TIMESTAMPTZ   NOT NULL,
  cdc_lag_seconds               INTEGER       NOT NULL CHECK (cdc_lag_seconds >= 0),
  CONSTRAINT attribution_reconciliation_residual_fits
    CHECK (unattributed_spend_inr <= total_spend_inr
       AND unattributed_enquiry_count <= total_enquiry_count),
  CONSTRAINT attribution_reconciliation_unique
    UNIQUE (org_id, window_start, window_end)
);

CREATE INDEX IF NOT EXISTS attribution_reconciliation_org_window_idx
  ON derived.attribution_reconciliation (org_id, window_start DESC);

ALTER TABLE derived.corridor_attribution_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE derived.corridor_attribution_daily FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON derived.corridor_attribution_daily
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

ALTER TABLE derived.attribution_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE derived.attribution_reconciliation FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON derived.attribution_reconciliation
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON derived.corridor_attribution_daily TO derived_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON derived.attribution_reconciliation TO derived_rw;
GRANT SELECT ON derived.corridor_attribution_daily   TO adsagent_rw;
GRANT SELECT ON derived.attribution_reconciliation   TO adsagent_rw;

COMMENT ON TABLE derived.corridor_attribution_daily IS
  'QUARANTINE. Projection of a ClickHouse rollup. Truncatable and rebuildable at any time, never the input to another derivation, and never the sole justification for a proposal (dataflow review A-5).';
COMMENT ON TABLE derived.attribution_reconciliation IS
  'QUARANTINE. Per-window residual: spend and enquiries that could not be attributed to a corridor, reported as their own figures rather than spread across corridors.';
COMMENT ON COLUMN derived.corridor_attribution_daily.late_enquiry_count IS
  'Enquiries that arrived after the window closed. Never folded into cost_per_enquiry_inr: closed figures are frozen.';

COMMIT;
```

```sql
-- ads-agent/lib/db/migrations/074_derived_attribution.down.sql
BEGIN;
DROP POLICY IF EXISTS tenant_isolation ON derived.attribution_reconciliation;
DROP POLICY IF EXISTS tenant_isolation ON derived.corridor_attribution_daily;
DROP INDEX IF EXISTS derived.attribution_reconciliation_org_window_idx;
DROP INDEX IF EXISTS derived.corridor_attribution_org_window_idx;
DROP TABLE IF EXISTS derived.attribution_reconciliation;
DROP TABLE IF EXISTS derived.corridor_attribution_daily;
COMMIT;
```

- [ ] **Step 8: Run the static test and watch it pass**

Run: `cd ads-agent && npx vitest run lib/db/migrations/attribution-migrations.test.ts`
Expected: PASS — 20 tests.

- [ ] **Step 9: Apply the five migrations against the local instance and verify**

Run each in order:

```bash
cd ads-agent
for n in 070_corridors 071_listing_corridors 072_campaign_corridor_id 073_enquiry_corridor_fk 074_derived_attribution; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "lib/db/migrations/${n}.up.sql" || break
done
```

Expected: `BEGIN` / `CREATE TABLE` / `INSERT 0 n` / `COMMIT` per file, no `ERROR`.

Then verify the seed and the mapping:

```bash
psql "$DATABASE_URL" -c "SELECT count(*) AS corridors FROM public.corridors"
psql "$DATABASE_URL" -c "SELECT confidence, count(*) FROM listings.listing_corridors GROUP BY confidence ORDER BY confidence DESC"
psql "$DATABASE_URL" -c "SELECT count(*) AS unmapped FROM listings.listings l WHERE NOT EXISTS (SELECT 1 FROM listings.listing_corridors lc WHERE lc.listing_id = l.id)"
```

Expected: `corridors` = 19 (17 top-level plus 2 ORR children, of which `outer-ring-road` is one of the 17). A non-zero `unmapped` count is **expected and correct** — record the number in the commit message; it is the honest size of the mapping gap, not a defect to paper over.

Then verify the fabrication guard actually rejects:

```bash
psql "$DATABASE_URL" -c "INSERT INTO derived.corridor_attribution_daily (org_id, corridor_id, window_start, window_end, window_state, spend_inr, enquiry_count, cost_per_enquiry_inr, source_watermark, cdc_lag_seconds) SELECT id, NULL, '2026-08-01', '2026-08-07', 'open', 5000, 0, 5000, now(), 0 FROM public.orgs LIMIT 1"
```

Expected: `ERROR: new row for relation "corridor_attribution_daily" violates check constraint "corridor_attribution_cost_is_real"`.

- [ ] **Step 10: Verify every down migration reverses cleanly**

```bash
cd ads-agent
for n in 074_derived_attribution 073_enquiry_corridor_fk 072_campaign_corridor_id 071_listing_corridors 070_corridors; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "lib/db/migrations/${n}.down.sql" || break
done
```

Expected: no `ERROR`. Then re-apply the ups from Step 9 to leave the database in the forward state.

- [ ] **Step 11: Commit**

```bash
git add ads-agent/lib/db/migrations/
git commit -m "feat(attribution): corridors, listing mapping, and the derived quarantine tables

campaigns.corridor was dead TEXT with one comment as its only reference.
Corridors become a real entity with a controlled vocabulary and aliases,
listings map to them with a recorded confidence, and the rollup projection
lands in the derived quarantine with a CHECK that refuses to store a cost
per enquiry for a corridor with no enquiries.

There is deliberately no catch-all corridor. Unmapped listings: <N>."
```

## Task 2: Attribution windows and late conversions

**Files:**
- Create: `ads-agent/lib/attribution/window.ts`
- Test: `ads-agent/lib/attribution/window.test.ts`

**Skills:** `typescript-pro`, `tdd-guide`
**Model:** `composer-2.5-fast` — the arithmetic and every test case are written out below.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `const ATTRIBUTION_TIMEZONE_OFFSET_MINUTES = 330`
  - `const ATTRIBUTION_CLOSE_DAYS = 14`
  - `type AttributionWindow = { startDate: string; endDate: string }` — inclusive `YYYY-MM-DD` IST calendar dates
  - `type WindowState = "open" | "closed"`
  - `function istCalendarDate(at: Date): string`
  - `function windowState(w: AttributionWindow, now: Date): WindowState`
  - `function trailingWindow(days: number, now: Date): AttributionWindow`
  - `function classifyEnquiry(firstSeenAt: Date, w: AttributionWindow): "in_window" | "outside"`

  Tasks 5, 6, 8, 9 and 10 import `AttributionWindow` and `WindowState` by these exact names.

**Context:** backend spec D6 requires "a derived metric with a defined window" and does not define one. The plan's Decisions section settles it: inclusive IST calendar dates, 14 days to close, frozen thereafter. IST is UTC+05:30 with no daylight saving, so the offset is a constant and no timezone dependency is needed — which matters, because the Global Constraints forbid adding one.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/attribution/window.test.ts
import { describe, it, expect } from "vitest";
import {
  ATTRIBUTION_CLOSE_DAYS,
  classifyEnquiry,
  istCalendarDate,
  trailingWindow,
  windowState,
} from "./window";

describe("istCalendarDate", () => {
  it("uses the IST calendar day, not the UTC one", () => {
    // 2026-08-11T19:30:00Z is 2026-08-12T01:00 IST — a different calendar day.
    expect(istCalendarDate(new Date("2026-08-11T19:30:00Z"))).toBe("2026-08-12");
  });

  it("keeps a mid-afternoon IST instant on the same day", () => {
    expect(istCalendarDate(new Date("2026-08-12T08:22:00Z"))).toBe("2026-08-12");
  });

  it("puts the last instant before IST midnight on the earlier day", () => {
    expect(istCalendarDate(new Date("2026-08-11T18:29:59Z"))).toBe("2026-08-11");
  });
});

describe("trailingWindow", () => {
  it("returns an inclusive range of the requested length ending today in IST", () => {
    expect(trailingWindow(7, new Date("2026-08-12T08:00:00Z"))).toEqual({
      startDate: "2026-08-06",
      endDate: "2026-08-12",
    });
  });

  it("returns a single day for a window of one", () => {
    expect(trailingWindow(1, new Date("2026-08-12T08:00:00Z"))).toEqual({
      startDate: "2026-08-12",
      endDate: "2026-08-12",
    });
  });

  it("rejects a non-positive length rather than inventing a range", () => {
    expect(() => trailingWindow(0, new Date("2026-08-12T08:00:00Z"))).toThrow(/at least 1 day/);
  });
});

describe("windowState", () => {
  const w = { startDate: "2026-07-01", endDate: "2026-07-07" };

  it("is open on the last day of the window", () => {
    expect(windowState(w, new Date("2026-07-07T10:00:00Z"))).toBe("open");
  });

  it("is still open one day before the close deadline", () => {
    expect(windowState(w, new Date("2026-07-20T10:00:00Z"))).toBe("open");
  });

  it("closes exactly ATTRIBUTION_CLOSE_DAYS after the end date", () => {
    expect(ATTRIBUTION_CLOSE_DAYS).toBe(14);
    // 2026-07-07 + 14 days = 2026-07-21 IST.
    expect(windowState(w, new Date("2026-07-21T00:00:00Z"))).toBe("closed");
  });

  it("stays closed long afterwards", () => {
    expect(windowState(w, new Date("2027-01-01T00:00:00Z"))).toBe("closed");
  });
});

describe("classifyEnquiry", () => {
  const w = { startDate: "2026-08-01", endDate: "2026-08-07" };

  it("counts an enquiry on the first day of the window", () => {
    expect(classifyEnquiry(new Date("2026-07-31T19:00:00Z"), w)).toBe("in_window");
  });

  it("counts an enquiry on the last day of the window", () => {
    expect(classifyEnquiry(new Date("2026-08-07T15:00:00Z"), w)).toBe("in_window");
  });

  it("excludes an enquiry before the window", () => {
    expect(classifyEnquiry(new Date("2026-07-30T10:00:00Z"), w)).toBe("outside");
  });

  it("excludes an enquiry after the window", () => {
    expect(classifyEnquiry(new Date("2026-08-08T10:00:00Z"), w)).toBe("outside");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/attribution/window.test.ts`
Expected: FAIL — `Failed to resolve import "./window"`.

- [ ] **Step 3: Write the implementation**

```ts
// ads-agent/lib/attribution/window.ts

/** IST is UTC+05:30 and has no daylight saving, so the offset is a constant rather than
 *  a timezone-database lookup. This is what lets attribution windows align to a broker's
 *  calendar day without adding a dependency. */
export const ATTRIBUTION_TIMEZONE_OFFSET_MINUTES = 330;

/** A window closes 14 days after its end date and its figures are frozen from then on.
 *  Both the enquiry loop and Google Ads conversion import settle well inside two weeks. */
export const ATTRIBUTION_CLOSE_DAYS = 14;

const MS_PER_DAY = 86_400_000;

/** Inclusive IST calendar dates, `YYYY-MM-DD`. */
export type AttributionWindow = { startDate: string; endDate: string };

export type WindowState = "open" | "closed";

export function istCalendarDate(at: Date): string {
  const shifted = new Date(at.getTime() + ATTRIBUTION_TIMEZONE_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function dateOnlyMs(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`);
}

export function trailingWindow(days: number, now: Date): AttributionWindow {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`attribution window must span at least 1 day, got ${days}`);
  }
  const endDate = istCalendarDate(now);
  const startDate = new Date(dateOnlyMs(endDate) - (days - 1) * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  return { startDate, endDate };
}

export function windowState(w: AttributionWindow, now: Date): WindowState {
  const closesOnMs = dateOnlyMs(w.endDate) + ATTRIBUTION_CLOSE_DAYS * MS_PER_DAY;
  return dateOnlyMs(istCalendarDate(now)) >= closesOnMs ? "closed" : "open";
}

export function classifyEnquiry(
  firstSeenAt: Date,
  w: AttributionWindow,
): "in_window" | "outside" {
  const day = istCalendarDate(firstSeenAt);
  return day >= w.startDate && day <= w.endDate ? "in_window" : "outside";
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd ads-agent && npx vitest run lib/attribution/window.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/attribution/window.ts ads-agent/lib/attribution/window.test.ts
git commit -m "feat(attribution): define the attribution window in IST calendar days

Backend spec D6 requires a defined window and does not define one. Windows
are inclusive IST calendar dates, close 14 days after their end date, and
are frozen once closed."
```

## Task 3: Freshness, quarantine, and org scope

**Files:**
- Create: `ads-agent/lib/attribution/freshness.ts`
- Test: `ads-agent/lib/attribution/freshness.test.ts`
- Create: `ads-agent/lib/attribution/quarantine.ts`
- Test: `ads-agent/lib/attribution/quarantine.test.ts`
- Create: `ads-agent/lib/attribution/org-scope.ts`
- Test: `ads-agent/lib/attribution/org-scope.test.ts`

**Skills:** `senior-backend`, `tdd-guide`
**Model:** `composer-2.5-fast` — three small policy modules, fully written out below.

**Interfaces:**
- Consumes: `type Scope` from `../db/scope-sql` (S3); `type Session` from `../auth/dal`.
- Produces:
  - `const ATTRIBUTION_MAX_LAG_SECONDS = 900`
  - `type AttributionFreshness = { computedAt: string; sourceWatermark: string; cdcLagSeconds: number; isStale: boolean }`
  - `function freshness(computedAt: Date, sourceWatermark: Date): AttributionFreshness`
  - `class StaleAttributionError extends Error`
  - `function assertFreshEnoughToSpend(f: AttributionFreshness): void`
  - `type Authority = "record" | "derived"`
  - `type Justification = { authority: Authority; ref: string }`
  - `class DerivedOnlyJustificationError extends Error`
  - `function assertNotSoleDerivedJustification(js: Justification[]): void`
  - `function orgScopeFromSession(session: Session): Scope`

  Tasks 8, 9 and 10 import all of these.

**Context:** datastore spec §12.1 — "Every context pack the MCP server returns carries `built_at` and current lag. An agent cannot obtain data without also obtaining its age," and "agents refuse to propose anything that changes spend when lag exceeds a threshold (default 15 minutes). Refusing is correct behaviour, not an error." The `derived` quarantine rule (data model §0, dataflow review A-5) is the second half: a derived figure can inform, never justify alone. `orgScopeFromSession` exists because a tool surface must never read across orgs — platform staff use the staff query layer at S11 (backend spec E7), not this path.

- [ ] **Step 1: Write the three failing tests**

```ts
// ads-agent/lib/attribution/freshness.test.ts
import { describe, it, expect } from "vitest";
import {
  ATTRIBUTION_MAX_LAG_SECONDS,
  assertFreshEnoughToSpend,
  freshness,
  StaleAttributionError,
} from "./freshness";

describe("freshness", () => {
  it("reports lag as the gap between the watermark and the computation", () => {
    const f = freshness(new Date("2026-08-12T10:05:00Z"), new Date("2026-08-12T10:00:00Z"));
    expect(f.cdcLagSeconds).toBe(300);
    expect(f.isStale).toBe(false);
    expect(f.computedAt).toBe("2026-08-12T10:05:00.000Z");
    expect(f.sourceWatermark).toBe("2026-08-12T10:00:00.000Z");
  });

  it("is stale once lag exceeds the threshold", () => {
    expect(ATTRIBUTION_MAX_LAG_SECONDS).toBe(900);
    const f = freshness(new Date("2026-08-12T10:16:00Z"), new Date("2026-08-12T10:00:00Z"));
    expect(f.cdcLagSeconds).toBe(960);
    expect(f.isStale).toBe(true);
  });

  it("clamps a watermark ahead of the computation to zero rather than reporting negative lag", () => {
    const f = freshness(new Date("2026-08-12T10:00:00Z"), new Date("2026-08-12T10:00:05Z"));
    expect(f.cdcLagSeconds).toBe(0);
  });
});

describe("assertFreshEnoughToSpend", () => {
  it("passes fresh data through", () => {
    const f = freshness(new Date("2026-08-12T10:01:00Z"), new Date("2026-08-12T10:00:00Z"));
    expect(() => assertFreshEnoughToSpend(f)).not.toThrow();
  });

  it("refuses stale data, and says refusing is correct", () => {
    const f = freshness(new Date("2026-08-12T11:00:00Z"), new Date("2026-08-12T10:00:00Z"));
    expect(() => assertFreshEnoughToSpend(f)).toThrow(StaleAttributionError);
    expect(() => assertFreshEnoughToSpend(f)).toThrow(/refusing is correct behaviour/);
  });
});
```

```ts
// ads-agent/lib/attribution/quarantine.test.ts
import { describe, it, expect } from "vitest";
import {
  assertNotSoleDerivedJustification,
  DerivedOnlyJustificationError,
  type Justification,
} from "./quarantine";

const derived: Justification = { authority: "derived", ref: "derived.corridor_attribution_daily:1" };
const record: Justification = { authority: "record", ref: "adsagent.enquiries:2" };

describe("assertNotSoleDerivedJustification", () => {
  it("accepts a justification anchored in a record", () => {
    expect(() => assertNotSoleDerivedJustification([derived, record])).not.toThrow();
  });

  it("rejects a justification built only from derived figures", () => {
    expect(() => assertNotSoleDerivedJustification([derived, derived])).toThrow(
      DerivedOnlyJustificationError,
    );
  });

  it("rejects no justification at all", () => {
    expect(() => assertNotSoleDerivedJustification([])).toThrow(DerivedOnlyJustificationError);
  });

  it("names the quarantine rule in the message so the reason is not guessed", () => {
    expect(() => assertNotSoleDerivedJustification([derived])).toThrow(/quarantine/i);
  });
});
```

```ts
// ads-agent/lib/attribution/org-scope.test.ts
import { describe, it, expect } from "vitest";
import { orgScopeFromSession } from "./org-scope";

describe("orgScopeFromSession", () => {
  it("returns org scope for a session with an org", () => {
    expect(
      orgScopeFromSession({
        userId: "u1",
        email: "a@b.c",
        orgId: "33333333-3333-3333-3333-333333333333",
        role: "viewer",
      }),
    ).toEqual({ kind: "org", orgId: "33333333-3333-3333-3333-333333333333" });
  });

  it("throws for a session with no org rather than reading unscoped", () => {
    expect(() =>
      orgScopeFromSession({ userId: "u1", email: "a@b.c", orgId: null, role: "viewer" }),
    ).toThrow(/no org/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ads-agent && npx vitest run lib/attribution/freshness.test.ts lib/attribution/quarantine.test.ts lib/attribution/org-scope.test.ts`
Expected: FAIL — three unresolved imports.

- [ ] **Step 3: Write `freshness.ts`**

```ts
// ads-agent/lib/attribution/freshness.ts

/** Datastore spec §12.1: agents refuse to propose anything that changes spend when CDC
 *  lag exceeds this threshold. Fifteen minutes is the spec's default. */
export const ATTRIBUTION_MAX_LAG_SECONDS = 900;

export type AttributionFreshness = {
  computedAt: string;
  sourceWatermark: string;
  cdcLagSeconds: number;
  isStale: boolean;
};

export class StaleAttributionError extends Error {
  constructor(public readonly cdcLagSeconds: number) {
    super(
      `attribution is ${cdcLagSeconds}s behind the source, above the ${ATTRIBUTION_MAX_LAG_SECONDS}s ` +
        `threshold — refusing is correct behaviour, not an error`,
    );
    this.name = "StaleAttributionError";
  }
}

export function freshness(computedAt: Date, sourceWatermark: Date): AttributionFreshness {
  const lagMs = computedAt.getTime() - sourceWatermark.getTime();
  // A watermark ahead of the computation means clock skew, not negative lag.
  const cdcLagSeconds = Math.max(0, Math.round(lagMs / 1000));
  return {
    computedAt: computedAt.toISOString(),
    sourceWatermark: sourceWatermark.toISOString(),
    cdcLagSeconds,
    isStale: cdcLagSeconds > ATTRIBUTION_MAX_LAG_SECONDS,
  };
}

export function assertFreshEnoughToSpend(f: AttributionFreshness): void {
  if (f.isStale) throw new StaleAttributionError(f.cdcLagSeconds);
}
```

- [ ] **Step 4: Write `quarantine.ts`**

```ts
// ads-agent/lib/attribution/quarantine.ts

/** `record` = a Postgres system-of-record row. `derived` = anything projected back into
 *  Postgres from ClickHouse, which lives in the `derived` quarantine schema. */
export type Authority = "record" | "derived";

export type Justification = { authority: Authority; ref: string };

export class DerivedOnlyJustificationError extends Error {
  constructor() {
    super(
      "every justification is a derived figure: the `derived` schema is a quarantine and may " +
        "never be the sole justification for a proposal (data model §0, dataflow review A-5)",
    );
    this.name = "DerivedOnlyJustificationError";
  }
}

export function assertNotSoleDerivedJustification(js: Justification[]): void {
  if (!js.some((j) => j.authority === "record")) throw new DerivedOnlyJustificationError();
}
```

- [ ] **Step 5: Write `org-scope.ts`**

```ts
// ads-agent/lib/attribution/org-scope.ts
import type { Session } from "../auth/dal";
import type { Scope } from "../db/scope-sql";

/** Attribution surfaces read one org's numbers and never span orgs. Cross-org analytics is
 *  the privileged audited path (datastore spec §5.1) and the staff query layer at S11 —
 *  not this function. */
export function orgScopeFromSession(session: Session): Scope {
  if (!session.orgId) {
    throw new Error("session has no org: cannot read attribution without a tenant");
  }
  return { kind: "org", orgId: session.orgId };
}
```

- [ ] **Step 6: Run them and watch them pass**

Run: `cd ads-agent && npx vitest run lib/attribution/freshness.test.ts lib/attribution/quarantine.test.ts lib/attribution/org-scope.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/attribution/freshness.ts ads-agent/lib/attribution/freshness.test.ts \
        ads-agent/lib/attribution/quarantine.ts ads-agent/lib/attribution/quarantine.test.ts \
        ads-agent/lib/attribution/org-scope.ts ads-agent/lib/attribution/org-scope.test.ts
git commit -m "feat(attribution): freshness, quarantine, and org-scope policy

An attribution number that is stale must be able to say so (datastore
§12.1), and a derived figure can inform a proposal but never justify one
alone (dataflow review A-5)."
```

## Task 4: Per-space cost allocation (D5)

**Files:**
- Create: `ads-agent/lib/attribution/allocation.ts`
- Test: `ads-agent/lib/attribution/allocation.test.ts`

**Skills:** `statistical-analyst`, `typescript-pro`
**Model:** `composer-2.5-fast` — the rule and every test case are written out below.

**Interfaces:**
- Consumes: nothing. Deliberately takes plain numbers rather than importing `CorridorAttribution` from Task 5, so this task can run in the same wave.
- Produces:
  - `type AllocationBasis = "equal_split"`
  - `type PerSpaceCostEstimate = { isEstimate: true; basis: AllocationBasis; corridorId: string; listingId: string; estimatedSpendShareInr: number; estimatedCostPerEnquiryInr: number | null }`
  - `function allocateEqualSplit(input: { corridorId: string; spendInr: number; enquiryCount: number; listingIds: string[] }): PerSpaceCostEstimate[]`

  Tasks 9 and 10 import `PerSpaceCostEstimate` and `allocateEqualSplit`.

**Context:** backend spec BD4 — campaigns are corridor-level and `campaign_drafts.final_url` defaults to the `/spaces` index, so **spend cannot be measured per space**; per-space cost is "an allocation, not a measurement, and the UI must label it as an estimate." Backend spec §6 records the same gap: My spaces shows "₹840 each" and that number is an allocation. `isEstimate: true` is a literal type, so a measured figure cannot be passed where an estimate is expected, and the label cannot be forgotten.

Backend spec §5 Q5 asked equal-split versus enquiry-weighted. Equal split wins: weighting by enquiry volume is circular when enquiries are the metric being derived.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/attribution/allocation.test.ts
import { describe, it, expect } from "vitest";
import { allocateEqualSplit } from "./allocation";

const CORRIDOR = "44444444-4444-4444-4444-444444444444";

describe("allocateEqualSplit", () => {
  it("splits corridor spend equally and labels every row an estimate", () => {
    const rows = allocateEqualSplit({
      corridorId: CORRIDOR,
      spendInr: 3000,
      enquiryCount: 6,
      listingIds: ["l1", "l2", "l3"],
    });

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.isEstimate).toBe(true);
      expect(row.basis).toBe("equal_split");
      expect(row.corridorId).toBe(CORRIDOR);
      expect(row.estimatedSpendShareInr).toBe(1000);
      expect(row.estimatedCostPerEnquiryInr).toBe(500);
    }
  });

  it("conserves spend exactly — the shares sum back to the corridor total", () => {
    const rows = allocateEqualSplit({
      corridorId: CORRIDOR,
      spendInr: 1000,
      enquiryCount: 3,
      listingIds: ["l1", "l2", "l3"],
    });
    const summed = rows.reduce((t, r) => t + r.estimatedSpendShareInr, 0);
    expect(summed).toBeCloseTo(1000, 9);
  });

  it("returns no rows when the corridor has no listings rather than dividing by zero", () => {
    expect(
      allocateEqualSplit({ corridorId: CORRIDOR, spendInr: 5000, enquiryCount: 2, listingIds: [] }),
    ).toEqual([]);
  });

  it("gives a null cost per enquiry when the corridor has no enquiries, never zero", () => {
    const [row] = allocateEqualSplit({
      corridorId: CORRIDOR,
      spendInr: 5000,
      enquiryCount: 0,
      listingIds: ["l1"],
    });
    expect(row.estimatedSpendShareInr).toBe(5000);
    expect(row.estimatedCostPerEnquiryInr).toBeNull();
  });

  it("rejects negative spend rather than allocating it", () => {
    expect(() =>
      allocateEqualSplit({ corridorId: CORRIDOR, spendInr: -1, enquiryCount: 1, listingIds: ["l1"] }),
    ).toThrow(/negative spend/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/attribution/allocation.test.ts`
Expected: FAIL — `Failed to resolve import "./allocation"`.

- [ ] **Step 3: Write the implementation**

```ts
// ads-agent/lib/attribution/allocation.ts

export type AllocationBasis = "equal_split";

/** Backend spec BD4: campaigns are corridor-level, so per-space spend cannot be measured.
 *  `isEstimate` is a literal `true` so a measurement cannot be passed as an estimate, nor
 *  an estimate rendered as a measurement. `basis` keeps the rule legible and swappable. */
export type PerSpaceCostEstimate = {
  isEstimate: true;
  basis: AllocationBasis;
  corridorId: string;
  listingId: string;
  estimatedSpendShareInr: number;
  estimatedCostPerEnquiryInr: number | null;
};

export function allocateEqualSplit(input: {
  corridorId: string;
  spendInr: number;
  enquiryCount: number;
  listingIds: string[];
}): PerSpaceCostEstimate[] {
  if (input.spendInr < 0) throw new Error(`cannot allocate negative spend: ${input.spendInr}`);
  if (input.listingIds.length === 0) return [];

  const share = input.spendInr / input.listingIds.length;
  // Enquiries are corridor-level here too: an equal split of spend over listings says nothing
  // about which listing the enquiries arrived through, so the per-enquiry figure is the
  // corridor's, carried through unchanged. Not rounded — the caller formats.
  const perEnquiry = input.enquiryCount > 0 ? input.spendInr / input.enquiryCount : null;

  return input.listingIds.map((listingId) => ({
    isEstimate: true as const,
    basis: "equal_split" as const,
    corridorId: input.corridorId,
    listingId,
    estimatedSpendShareInr: share,
    estimatedCostPerEnquiryInr: perEnquiry,
  }));
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd ads-agent && npx vitest run lib/attribution/allocation.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/attribution/allocation.ts ads-agent/lib/attribution/allocation.test.ts
git commit -m "feat(attribution): per-space cost as a labelled equal-split estimate

BD4: spend is corridor-level and cannot be measured per space. The type
carries isEstimate: true as a literal so the label cannot be dropped, and
the shares conserve the corridor total exactly."
```

---

# Wave 2

## Task 5: Reconciliation — the honesty core (D4, D6)

**Files:**
- Create: `ads-agent/lib/attribution/reconcile.ts`
- Test: `ads-agent/lib/attribution/reconcile.test.ts`

**Skills:** `data-analyst`, `statistical-analyst`, `tdd-guide`
**Model:** `inherit` — this is the task where the gate is won or lost; it needs judgement about what the invariant must catch.

**Interfaces:**
- Consumes: `type AttributionWindow`, `type WindowState` from `./window` (Task 2).
- Produces:
  - `type CorridorSpendRow = { corridorId: string | null; spendInr: number }`
  - `type CorridorEnquiryRow = { corridorId: string | null; enquiryCount: number }`
  - `type CorridorAttribution = { corridorId: string; spendInr: number; enquiryCount: number; costPerEnquiryInr: number | null }`
  - `type AttributionResidual = { unattributedSpendInr: number; unattributedEnquiryCount: number; spendWithoutEnquiriesInr: number; enquiriesWithoutSpendCount: number }`
  - `type AttributionResult = { window: AttributionWindow; windowState: WindowState; corridors: CorridorAttribution[]; residual: AttributionResidual; lateEnquiryCount: number; totals: { spendInr: number; enquiryCount: number } }`
  - `class AttributionConservationError extends Error`
  - `function reconcile(input: { window: AttributionWindow; windowState: WindowState; spend: CorridorSpendRow[]; enquiries: CorridorEnquiryRow[] }): AttributionResult`
  - `function assertConserved(result: AttributionResult): void`
  - `function applyFrozenWindow(frozen: AttributionResult, fresh: AttributionResult): AttributionResult`

  Tasks 6, 8, 9 and 10 import these names.

**Context:** this is the S7 gate. The dangerous failure is not a crash — it is a plausible-looking cost per lead derived from an incomplete join. Two shapes of incompleteness exist and both must be named rather than absorbed:

- **Spend with no matching enquiry.** Either the campaign has no `corridor_id` (unattributable at all), or its corridor has zero enquiries in the window. The first is `unattributedSpendInr`; the second is `spendWithoutEnquiriesInr`.
- **Enquiries with no attributable spend.** Either the enquiry resolved to no corridor, or its corridor has zero spend. `unattributedEnquiryCount` and `enquiriesWithoutSpendCount`.

`unattributedSpendInr` and `spendWithoutEnquiriesInr` measure different things and are reported separately: the first is a mapping gap, the second is a real business fact (money spent, nothing came back).

`applyFrozenWindow` implements the late-conversion decision. A closed window's figures never change; the delta between the current and the frozen enquiry count becomes `lateEnquiryCount`. No new ClickHouse column is needed for this — the frozen row is itself the record of what was counted.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/attribution/reconcile.test.ts
import { describe, it, expect } from "vitest";
import {
  applyFrozenWindow,
  assertConserved,
  AttributionConservationError,
  reconcile,
  type AttributionResult,
} from "./reconcile";

const WINDOW = { startDate: "2026-08-01", endDate: "2026-08-07" };
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function run(
  spend: { corridorId: string | null; spendInr: number }[],
  enquiries: { corridorId: string | null; enquiryCount: number }[],
): AttributionResult {
  return reconcile({ window: WINDOW, windowState: "open", spend, enquiries });
}

describe("reconcile", () => {
  it("computes cost per enquiry per corridor", () => {
    const r = run([{ corridorId: A, spendInr: 2000 }], [{ corridorId: A, enquiryCount: 4 }]);
    expect(r.corridors).toEqual([
      { corridorId: A, spendInr: 2000, enquiryCount: 4, costPerEnquiryInr: 500 },
    ]);
    expect(r.totals).toEqual({ spendInr: 2000, enquiryCount: 4 });
  });

  it("reports spend with no corridor as its own figure, never spread across corridors", () => {
    const r = run(
      [
        { corridorId: A, spendInr: 1000 },
        { corridorId: B, spendInr: 1000 },
        { corridorId: null, spendInr: 600 },
      ],
      [
        { corridorId: A, enquiryCount: 2 },
        { corridorId: B, enquiryCount: 2 },
      ],
    );

    // The fabrication would be 1300 each. The honest answer is 1000 each plus a named 600.
    expect(r.corridors.map((c) => c.spendInr)).toEqual([1000, 1000]);
    expect(r.corridors.map((c) => c.costPerEnquiryInr)).toEqual([500, 500]);
    expect(r.residual.unattributedSpendInr).toBe(600);
    expect(r.totals.spendInr).toBe(2600);
  });

  it("reports enquiries with no corridor as their own figure", () => {
    const r = run(
      [{ corridorId: A, spendInr: 1000 }],
      [
        { corridorId: A, enquiryCount: 2 },
        { corridorId: null, enquiryCount: 5 },
      ],
    );
    expect(r.corridors[0].enquiryCount).toBe(2);
    expect(r.corridors[0].costPerEnquiryInr).toBe(500);
    expect(r.residual.unattributedEnquiryCount).toBe(5);
    expect(r.totals.enquiryCount).toBe(7);
  });

  it("gives null cost per enquiry — never zero, never the spend — for a corridor with no enquiries", () => {
    const r = run([{ corridorId: A, spendInr: 900 }], []);
    expect(r.corridors[0]).toEqual({
      corridorId: A,
      spendInr: 900,
      enquiryCount: 0,
      costPerEnquiryInr: null,
    });
    expect(r.residual.spendWithoutEnquiriesInr).toBe(900);
  });

  it("keeps a corridor with enquiries and no spend, and counts it separately", () => {
    const r = run([], [{ corridorId: A, enquiryCount: 3 }]);
    expect(r.corridors[0]).toEqual({
      corridorId: A,
      spendInr: 0,
      enquiryCount: 3,
      costPerEnquiryInr: 0,
    });
    expect(r.residual.enquiriesWithoutSpendCount).toBe(3);
  });

  it("sums duplicate rows for the same corridor", () => {
    const r = run(
      [
        { corridorId: A, spendInr: 100 },
        { corridorId: A, spendInr: 250 },
      ],
      [
        { corridorId: A, enquiryCount: 1 },
        { corridorId: A, enquiryCount: 6 },
      ],
    );
    expect(r.corridors[0].spendInr).toBe(350);
    expect(r.corridors[0].enquiryCount).toBe(7);
  });

  it("orders corridors by spend descending so the biggest number is not buried", () => {
    const r = run(
      [
        { corridorId: A, spendInr: 100 },
        { corridorId: B, spendInr: 900 },
      ],
      [],
    );
    expect(r.corridors.map((c) => c.corridorId)).toEqual([B, A]);
  });

  it("rejects a negative spend row instead of netting it off another corridor", () => {
    expect(() => run([{ corridorId: A, spendInr: -10 }], [])).toThrow(/negative spend/);
  });
});

describe("assertConserved", () => {
  it("passes a reconciliation produced by reconcile", () => {
    const r = run(
      [
        { corridorId: A, spendInr: 1000 },
        { corridorId: null, spendInr: 600 },
      ],
      [
        { corridorId: A, enquiryCount: 2 },
        { corridorId: null, enquiryCount: 5 },
      ],
    );
    expect(() => assertConserved(r)).not.toThrow();
  });

  it("throws when unattributed spend is spread across corridors — the plausible fabrication", () => {
    const r = run(
      [
        { corridorId: A, spendInr: 1000 },
        { corridorId: B, spendInr: 1000 },
        { corridorId: null, spendInr: 600 },
      ],
      [
        { corridorId: A, enquiryCount: 2 },
        { corridorId: B, enquiryCount: 2 },
      ],
    );

    const fabricated: AttributionResult = {
      ...r,
      corridors: r.corridors.map((c) => ({
        ...c,
        spendInr: c.spendInr + r.residual.unattributedSpendInr / r.corridors.length,
        costPerEnquiryInr:
          (c.spendInr + r.residual.unattributedSpendInr / r.corridors.length) / c.enquiryCount,
      })),
    };

    expect(() => assertConserved(fabricated)).toThrow(AttributionConservationError);
    expect(() => assertConserved(fabricated)).toThrow(/spend/);
  });

  it("throws when the residual is quietly dropped instead of reported", () => {
    const r = run([{ corridorId: null, spendInr: 600 }], [{ corridorId: null, enquiryCount: 5 }]);
    const hidden: AttributionResult = {
      ...r,
      residual: { ...r.residual, unattributedSpendInr: 0, unattributedEnquiryCount: 0 },
    };
    expect(() => assertConserved(hidden)).toThrow(AttributionConservationError);
  });

  it("throws when a cost per enquiry does not follow from its own spend and count", () => {
    const r = run([{ corridorId: A, spendInr: 1000 }], [{ corridorId: A, enquiryCount: 4 }]);
    const wrong: AttributionResult = {
      ...r,
      corridors: [{ ...r.corridors[0], costPerEnquiryInr: 120 }],
    };
    expect(() => assertConserved(wrong)).toThrow(/cost per enquiry/);
  });

  it("throws when a corridor with no enquiries carries a cost per enquiry", () => {
    const r = run([{ corridorId: A, spendInr: 900 }], []);
    const wrong: AttributionResult = {
      ...r,
      corridors: [{ ...r.corridors[0], costPerEnquiryInr: 900 }],
    };
    expect(() => assertConserved(wrong)).toThrow(/cost per enquiry/);
  });
});

describe("applyFrozenWindow", () => {
  const frozen = reconcile({
    window: WINDOW,
    windowState: "closed",
    spend: [{ corridorId: A, spendInr: 1000 }],
    enquiries: [{ corridorId: A, enquiryCount: 4 }],
  });

  it("keeps the frozen figures and reports the late arrivals separately", () => {
    const fresh = reconcile({
      window: WINDOW,
      windowState: "closed",
      spend: [{ corridorId: A, spendInr: 1000 }],
      enquiries: [{ corridorId: A, enquiryCount: 7 }],
    });

    const merged = applyFrozenWindow(frozen, fresh);
    expect(merged.corridors[0].enquiryCount).toBe(4);
    expect(merged.corridors[0].costPerEnquiryInr).toBe(250);
    expect(merged.lateEnquiryCount).toBe(3);
    expect(() => assertConserved(merged)).not.toThrow();
  });

  it("reports zero late arrivals when nothing new landed", () => {
    expect(applyFrozenWindow(frozen, frozen).lateEnquiryCount).toBe(0);
  });

  it("never reports a negative late count when rows have been erased", () => {
    const fewer = reconcile({
      window: WINDOW,
      windowState: "closed",
      spend: [{ corridorId: A, spendInr: 1000 }],
      enquiries: [{ corridorId: A, enquiryCount: 1 }],
    });
    expect(applyFrozenWindow(frozen, fewer).lateEnquiryCount).toBe(0);
  });

  it("refuses to freeze a window that is still open", () => {
    const open = reconcile({ window: WINDOW, windowState: "open", spend: [], enquiries: [] });
    expect(() => applyFrozenWindow(open, open)).toThrow(/closed/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/attribution/reconcile.test.ts`
Expected: FAIL — `Failed to resolve import "./reconcile"`.

- [ ] **Step 3: Write the implementation**

```ts
// ads-agent/lib/attribution/reconcile.ts
import type { AttributionWindow, WindowState } from "./window";

export type CorridorSpendRow = { corridorId: string | null; spendInr: number };
export type CorridorEnquiryRow = { corridorId: string | null; enquiryCount: number };

export type CorridorAttribution = {
  corridorId: string;
  spendInr: number;
  enquiryCount: number;
  /** null when enquiryCount is 0. Never 0, and never the spend. */
  costPerEnquiryInr: number | null;
};

export type AttributionResidual = {
  /** Spend whose campaign has no corridor at all: a mapping gap. */
  unattributedSpendInr: number;
  /** Enquiries that resolved to no corridor: a mapping gap. */
  unattributedEnquiryCount: number;
  /** Spend in corridors that produced no enquiries: money out, nothing back. */
  spendWithoutEnquiriesInr: number;
  /** Enquiries in corridors with no spend in the window: organic, or spend outside it. */
  enquiriesWithoutSpendCount: number;
};

export type AttributionResult = {
  window: AttributionWindow;
  windowState: WindowState;
  corridors: CorridorAttribution[];
  residual: AttributionResidual;
  lateEnquiryCount: number;
  totals: { spendInr: number; enquiryCount: number };
};

export class AttributionConservationError extends Error {
  constructor(message: string) {
    super(`attribution is not conserved: ${message}`);
    this.name = "AttributionConservationError";
  }
}

/** Money is compared in paise-scale tolerance: these are sums of NUMERIC(18,4) values
 *  carried through IEEE doubles, so exact equality would fail on legitimate input. */
const MONEY_EPSILON = 1e-6;

function costPerEnquiry(spendInr: number, enquiryCount: number): number | null {
  return enquiryCount > 0 ? spendInr / enquiryCount : null;
}

export function reconcile(input: {
  window: AttributionWindow;
  windowState: WindowState;
  spend: CorridorSpendRow[];
  enquiries: CorridorEnquiryRow[];
}): AttributionResult {
  const spendByCorridor = new Map<string, number>();
  let unattributedSpendInr = 0;

  for (const row of input.spend) {
    if (row.spendInr < 0) throw new Error(`negative spend for corridor ${row.corridorId}: ${row.spendInr}`);
    if (row.corridorId === null) unattributedSpendInr += row.spendInr;
    else spendByCorridor.set(row.corridorId, (spendByCorridor.get(row.corridorId) ?? 0) + row.spendInr);
  }

  const enquiriesByCorridor = new Map<string, number>();
  let unattributedEnquiryCount = 0;

  for (const row of input.enquiries) {
    if (row.enquiryCount < 0) throw new Error(`negative enquiry count: ${row.enquiryCount}`);
    if (row.corridorId === null) unattributedEnquiryCount += row.enquiryCount;
    else {
      enquiriesByCorridor.set(
        row.corridorId,
        (enquiriesByCorridor.get(row.corridorId) ?? 0) + row.enquiryCount,
      );
    }
  }

  const corridorIds = new Set([...spendByCorridor.keys(), ...enquiriesByCorridor.keys()]);
  const corridors: CorridorAttribution[] = [...corridorIds]
    .map((corridorId) => {
      const spendInr = spendByCorridor.get(corridorId) ?? 0;
      const enquiryCount = enquiriesByCorridor.get(corridorId) ?? 0;
      return { corridorId, spendInr, enquiryCount, costPerEnquiryInr: costPerEnquiry(spendInr, enquiryCount) };
    })
    // Biggest number first: the figure most worth questioning should not be buried.
    .sort((a, b) => b.spendInr - a.spendInr || a.corridorId.localeCompare(b.corridorId));

  const residual: AttributionResidual = {
    unattributedSpendInr,
    unattributedEnquiryCount,
    spendWithoutEnquiriesInr: corridors
      .filter((c) => c.enquiryCount === 0)
      .reduce((t, c) => t + c.spendInr, 0),
    enquiriesWithoutSpendCount: corridors
      .filter((c) => c.spendInr === 0)
      .reduce((t, c) => t + c.enquiryCount, 0),
  };

  const result: AttributionResult = {
    window: input.window,
    windowState: input.windowState,
    corridors,
    residual,
    lateEnquiryCount: 0,
    totals: {
      spendInr: corridors.reduce((t, c) => t + c.spendInr, 0) + unattributedSpendInr,
      enquiryCount: corridors.reduce((t, c) => t + c.enquiryCount, 0) + unattributedEnquiryCount,
    },
  };

  assertConserved(result);
  return result;
}

export function assertConserved(result: AttributionResult): void {
  const spendSum =
    result.corridors.reduce((t, c) => t + c.spendInr, 0) + result.residual.unattributedSpendInr;
  if (Math.abs(spendSum - result.totals.spendInr) > MONEY_EPSILON) {
    throw new AttributionConservationError(
      `corridor spend plus unattributed spend is ${spendSum}, total spend is ${result.totals.spendInr}`,
    );
  }

  const enquirySum =
    result.corridors.reduce((t, c) => t + c.enquiryCount, 0) + result.residual.unattributedEnquiryCount;
  if (enquirySum !== result.totals.enquiryCount) {
    throw new AttributionConservationError(
      `corridor enquiries plus unattributed enquiries is ${enquirySum}, total is ${result.totals.enquiryCount}`,
    );
  }

  for (const c of result.corridors) {
    const expected = costPerEnquiry(c.spendInr, c.enquiryCount);
    const agrees =
      expected === null
        ? c.costPerEnquiryInr === null
        : c.costPerEnquiryInr !== null && Math.abs(c.costPerEnquiryInr - expected) <= MONEY_EPSILON;
    if (!agrees) {
      throw new AttributionConservationError(
        `corridor ${c.corridorId} reports cost per enquiry ${c.costPerEnquiryInr}, but ${c.spendInr} over ${c.enquiryCount} enquiries is ${expected}`,
      );
    }
  }
}

/** A closed window's figures are frozen. Enquiries that arrive afterwards are counted, named,
 *  and kept out of the cost — re-deriving a historical cost is the same failure as inventing one. */
export function applyFrozenWindow(
  frozen: AttributionResult,
  fresh: AttributionResult,
): AttributionResult {
  if (frozen.windowState !== "closed") {
    throw new Error("applyFrozenWindow requires a closed window; open windows are recomputed in full");
  }
  return {
    ...frozen,
    lateEnquiryCount: Math.max(0, fresh.totals.enquiryCount - frozen.totals.enquiryCount),
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd ads-agent && npx vitest run lib/attribution/reconcile.test.ts`
Expected: PASS — 21 tests. In particular, "throws when unattributed spend is spread across corridors" passes, which is the S7 gate in unit form.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/attribution/reconcile.ts ads-agent/lib/attribution/reconcile.test.ts
git commit -m "feat(attribution): reconcile spend against enquiries with a named residual

Unattributed spend and unattributed enquiries are reported as their own
figures. assertConserved throws when they are spread across corridors
instead -- the plausible-looking fabrication this step exists to catch."
```

## Task 6: The analytical source — which store, and why

**Files:**
- Create: `ads-agent/lib/attribution/analytical-source.ts`
- Test: `ads-agent/lib/attribution/analytical-source.test.ts`
- Create: `ads-agent/clickhouse/attribution/attribution.sql`

**Skills:** `senior-data-engineer`, `database-optimizer`
**Model:** `inherit` — the store-routing decision and the ClickHouse parameter binding need judgement.

**Interfaces:**
- Consumes: `type AttributionWindow` from `./window` (Task 2); `type CorridorSpendRow`, `type CorridorEnquiryRow` from `./reconcile` (Task 5) — **types only, no runtime import**; `type Scope` from `../db/scope-sql` (S3); `enquiry_fact` in ClickHouse from S6.
- Produces:
  - `type AnalyticalQuery = <T>(sql: string, params: Record<string, unknown>) => Promise<T[]>`
  - `function corridorSpendSql(): string`
  - `function corridorEnquirySql(): string`
  - `function sourceWatermarkSql(): string`
  - `function fetchCorridorSpend(scope: Scope, query: AnalyticalQuery, w: AttributionWindow): Promise<CorridorSpendRow[]>`
  - `function fetchCorridorEnquiries(scope: Scope, query: AnalyticalQuery, w: AttributionWindow): Promise<CorridorEnquiryRow[]>`
  - `function fetchSourceWatermark(scope: Scope, query: AnalyticalQuery): Promise<Date>`

  Task 8 imports all three `fetch*` functions and `AnalyticalQuery`.

**Context — the store-routing decision, stated explicitly.**

| Query | Store | Why |
|---|---|---|
| Corridor spend per window | **ClickHouse** `spend_fact` | Aggregation over a growing fact table; build sequence S14 states the rule for agents ("reads the replica, not the primary") and the same applies to any analytical rollup. |
| Corridor enquiry counts per window | **ClickHouse** `enquiry_fact` | Same shape, and it must join the spend aggregate. Datastore §3: "cross-system joins execute with only the ClickHouse portion pushed down… Keep analytical tables together in ClickHouse and join them there." Both facts therefore live in ClickHouse and the rollup never crosses stores. |
| CDC watermark | **ClickHouse** | The watermark *is* the mirror's own high-water mark. Asking Postgres would measure the wrong clock. |
| Corridor vocabulary, listing→corridor mapping, enquiry resolution | **Postgres** (Task 7) | Reference and mapping data with foreign keys and a `CHECK` on confidence. ClickHouse has neither (datastore §3.1). |
| The projected rollup, for display | **Postgres `derived`** (Task 8) | A dashboard read must be a single cheap indexed query, and the quarantine boundary is a Postgres schema. |

`scopeClause` is not used here: it emits Postgres `$n` placeholders and ClickHouse uses named `{name:Type}` parameters. This module derives its filter from the same `Scope` value and always filters on `scope.orgId`, for **both** scope kinds. Platform scope is not a cross-tenant read here — cross-tenant analytics is the privileged audited path of datastore §5.1, which S7 does not build.

`spend_fact` is not in data model §7, which shows only `enquiry_fact`. S7 defines it, following §7's conventions exactly: `org_id` first in `ORDER BY`, a row policy, `Nullable` for the genuinely optional key.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/attribution/analytical-source.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  corridorEnquirySql,
  corridorSpendSql,
  fetchCorridorEnquiries,
  fetchCorridorSpend,
  fetchSourceWatermark,
  type AnalyticalQuery,
} from "./analytical-source";

const ORG = "55555555-5555-5555-5555-555555555555";
const SCOPE = { kind: "org" as const, orgId: ORG };
const WINDOW = { startDate: "2026-08-01", endDate: "2026-08-07" };

describe("the SQL targets the analytical mirror, not the primary", () => {
  it("reads spend from spend_fact with a tenant-leading filter", () => {
    const sql = corridorSpendSql();
    expect(sql).toContain("FROM spend_fact");
    expect(sql).toContain("org_id = {org_id:UUID}");
    expect(sql).toContain("GROUP BY corridor_id");
  });

  it("reads enquiries from enquiry_fact, the S6 mirror table", () => {
    const sql = corridorEnquirySql();
    expect(sql).toContain("FROM enquiry_fact");
    expect(sql).toContain("org_id = {org_id:UUID}");
  });

  it("never references a Postgres schema — the join stays inside ClickHouse", () => {
    for (const sql of [corridorSpendSql(), corridorEnquirySql()]) {
      expect(sql).not.toMatch(/\b(adsagent|listings|derived|public)\./);
    }
  });
});

describe("fetchCorridorSpend", () => {
  it("binds the org and the window as named parameters", async () => {
    const query = vi.fn().mockResolvedValue([]) as unknown as AnalyticalQuery;
    await fetchCorridorSpend(SCOPE, query, WINDOW);
    expect(query).toHaveBeenCalledWith(corridorSpendSql(), {
      org_id: ORG,
      start: "2026-08-01",
      end: "2026-08-07",
    });
  });

  it("maps a null corridor to null rather than dropping the row", async () => {
    const query = vi
      .fn()
      .mockResolvedValue([
        { corridor_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", spend_inr: "1000.5" },
        { corridor_id: null, spend_inr: "600" },
      ]) as unknown as AnalyticalQuery;

    expect(await fetchCorridorSpend(SCOPE, query, WINDOW)).toEqual([
      { corridorId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", spendInr: 1000.5 },
      { corridorId: null, spendInr: 600 },
    ]);
  });

  it("uses the org id even under platform scope, because this path never spans tenants", async () => {
    const query = vi.fn().mockResolvedValue([]) as unknown as AnalyticalQuery;
    await fetchCorridorSpend({ kind: "platform", orgId: ORG }, query, WINDOW);
    expect(query).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ org_id: ORG }));
  });
});

describe("fetchCorridorEnquiries", () => {
  it("returns counts as numbers, preserving the null corridor bucket", async () => {
    const query = vi
      .fn()
      .mockResolvedValue([
        { corridor_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", enquiry_count: "4" },
        { corridor_id: null, enquiry_count: "2" },
      ]) as unknown as AnalyticalQuery;

    expect(await fetchCorridorEnquiries(SCOPE, query, WINDOW)).toEqual([
      { corridorId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", enquiryCount: 4 },
      { corridorId: null, enquiryCount: 2 },
    ]);
  });
});

describe("fetchSourceWatermark", () => {
  it("returns the newest mirrored commit timestamp", async () => {
    const query = vi
      .fn()
      .mockResolvedValue([{ watermark: "2026-08-12 10:00:00.000" }]) as unknown as AnalyticalQuery;
    expect((await fetchSourceWatermark(SCOPE, query)).toISOString()).toBe("2026-08-12T10:00:00.000Z");
  });

  it("throws when the mirror reports no watermark, rather than assuming now()", async () => {
    // Assuming now() would make empty or stalled CDC look perfectly fresh.
    const query = vi.fn().mockResolvedValue([]) as unknown as AnalyticalQuery;
    await expect(fetchSourceWatermark(SCOPE, query)).rejects.toThrow(/no watermark/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/attribution/analytical-source.test.ts`
Expected: FAIL — `Failed to resolve import "./analytical-source"`.

- [ ] **Step 3: Write the ClickHouse DDL**

```sql
-- ads-agent/clickhouse/attribution/attribution.sql
-- Applied with: clickhouse-client --queries-file ads-agent/clickhouse/attribution/attribution.sql
--
-- enquiry_fact is created by S6 (data model §7). spend_fact is S7's own: data model §7 shows
-- enquiry_fact only, and attribution needs the spend side in the same store so the rollup join
-- never crosses systems (datastore spec §3). Conventions follow §7 exactly: tenant leads the
-- ORDER BY, a row policy per table, Nullable only for genuinely optional keys.
CREATE TABLE IF NOT EXISTS spend_fact (
  org_id      UUID,
  campaign_id UUID,
  corridor_id Nullable(UUID),
  captured_on Date,
  spend_inr   Decimal(18, 4),
  clicks      UInt32,
  impressions UInt32,
  conversions UInt32,
  snapshot_id UUID
) ENGINE = MergeTree
ORDER BY (org_id, captured_on, campaign_id);

CREATE ROW POLICY IF NOT EXISTS tenant_policy ON spend_fact
  USING org_id = toUUID(getSetting('SQL_current_tenant_id')) TO ALL;

-- The mirror's own high-water mark, per table. Read by fetchSourceWatermark so an
-- attribution figure always arrives with its age (datastore spec §12.1).
CREATE TABLE IF NOT EXISTS cdc_watermark (
  org_id      UUID,
  source      LowCardinality(String),   -- 'spend_fact' | 'enquiry_fact'
  watermark   DateTime64(3),
  observed_at DateTime64(3)
) ENGINE = ReplacingMergeTree(observed_at)
ORDER BY (org_id, source);

CREATE ROW POLICY IF NOT EXISTS tenant_policy ON cdc_watermark
  USING org_id = toUUID(getSetting('SQL_current_tenant_id')) TO ALL;
```

- [ ] **Step 4: Write the TypeScript**

```ts
// ads-agent/lib/attribution/analytical-source.ts
import type { Scope } from "../db/scope-sql";
import type { CorridorEnquiryRow, CorridorSpendRow } from "./reconcile";
import type { AttributionWindow } from "./window";

/** Injected so the rollup is testable without a running ClickHouse. The concrete
 *  implementation is the S6 client; this module is the only place S7 touches it. */
export type AnalyticalQuery = <T>(sql: string, params: Record<string, unknown>) => Promise<T[]>;

type SpendSqlRow = { corridor_id: string | null; spend_inr: string | number };
type EnquirySqlRow = { corridor_id: string | null; enquiry_count: string | number };
type WatermarkSqlRow = { watermark: string };

export function corridorSpendSql(): string {
  return `SELECT corridor_id, sum(spend_inr) AS spend_inr
            FROM spend_fact
           WHERE org_id = {org_id:UUID}
             AND captured_on >= {start:Date}
             AND captured_on <= {end:Date}
        GROUP BY corridor_id`;
}

export function corridorEnquirySql(): string {
  return `SELECT corridor_id, count() AS enquiry_count
            FROM enquiry_fact
           WHERE org_id = {org_id:UUID}
             AND occurred_on >= {start:Date}
             AND occurred_on <= {end:Date}
        GROUP BY corridor_id`;
}

export function sourceWatermarkSql(): string {
  return `SELECT min(watermark) AS watermark
            FROM cdc_watermark
           WHERE org_id = {org_id:UUID}
             AND source IN ('spend_fact', 'enquiry_fact')`;
}

/** Both scope kinds resolve to a single org here. Cross-tenant analytics is the privileged
 *  audited path (datastore spec §5.1) and is not built by S7. */
function windowParams(scope: Scope, w: AttributionWindow): Record<string, unknown> {
  return { org_id: scope.orgId, start: w.startDate, end: w.endDate };
}

export async function fetchCorridorSpend(
  scope: Scope,
  query: AnalyticalQuery,
  w: AttributionWindow,
): Promise<CorridorSpendRow[]> {
  const rows = await query<SpendSqlRow>(corridorSpendSql(), windowParams(scope, w));
  return rows.map((r) => ({ corridorId: r.corridor_id ?? null, spendInr: Number(r.spend_inr) }));
}

export async function fetchCorridorEnquiries(
  scope: Scope,
  query: AnalyticalQuery,
  w: AttributionWindow,
): Promise<CorridorEnquiryRow[]> {
  const rows = await query<EnquirySqlRow>(corridorEnquirySql(), windowParams(scope, w));
  return rows.map((r) => ({ corridorId: r.corridor_id ?? null, enquiryCount: Number(r.enquiry_count) }));
}

export async function fetchSourceWatermark(scope: Scope, query: AnalyticalQuery): Promise<Date> {
  const rows = await query<WatermarkSqlRow>(sourceWatermarkSql(), { org_id: scope.orgId });
  const raw = rows[0]?.watermark;
  // Defaulting to now() would make stalled or empty CDC look perfectly fresh, which is
  // exactly the silent degradation datastore §12.1 exists to prevent.
  if (!raw) throw new Error(`the analytical mirror reports no watermark for org ${scope.orgId}`);
  return new Date(`${raw.replace(" ", "T")}Z`);
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `cd ads-agent && npx vitest run lib/attribution/analytical-source.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 6: Apply the ClickHouse DDL and confirm the tables exist**

Run: `clickhouse-client --queries-file ads-agent/clickhouse/attribution/attribution.sql`
Then: `clickhouse-client -q "SHOW CREATE TABLE spend_fact"`
Expected: the `MergeTree` definition with `ORDER BY (org_id, captured_on, campaign_id)`.

If `enquiry_fact` does not exist, S6 has not landed — stop and escalate rather than creating it here. It belongs to S6 and duplicating its DDL would fork the schema.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/attribution/analytical-source.ts ads-agent/lib/attribution/analytical-source.test.ts \
        ads-agent/clickhouse/attribution/attribution.sql
git commit -m "feat(attribution): read the rollup from the analytical mirror

The spend x enquiry join is analytical, so both facts live in ClickHouse
and the join happens there -- datastore §3 forbids cross-system joins.
fetchSourceWatermark throws rather than defaulting to now(), because a
missing watermark would make stalled CDC look fresh."
```

## Task 7: Corridor and listing resolution in Postgres (D1, D2, D3)

**Files:**
- Create: `ads-agent/lib/attribution/listing-url.ts`
- Test: `ads-agent/lib/attribution/listing-url.test.ts`
- Create: `ads-agent/lib/db/corridors.ts`
- Test: `ads-agent/lib/db/corridors.test.ts`

**Skills:** `senior-backend`, `sql-pro`, `typescript-pro`
**Model:** `inherit` — the URL cases and the resolution SQL need care about what must *not* resolve.

**Interfaces:**
- Consumes: `type Scope`, `scopeClause` from `./scope-sql` (S3); `getPool` from `./client`; tables from Task 1 migrations 070–073.
- Produces:
  - `function listingSlugFromUrl(url: string): string | null`
  - `type Corridor = { id: string; slug: string; displayName: string; city: string; parentId: string | null }`
  - `function listCorridors(scope: Scope): Promise<Corridor[]>`
  - `function corridorListingIds(scope: Scope, corridorId: string): Promise<string[]>`
  - `function resolveEnquiryListings(scope: Scope, limit: number): Promise<number>`
  - `function countUnresolvedEnquiries(scope: Scope): Promise<number>`

  Tasks 9 and 10 import `listCorridors` and `corridorListingIds`; Task 11's gate exercises `resolveEnquiryListings` and `countUnresolvedEnquiries`.

**Context:** backend spec D3 — enquiries carry a `listingUrl` string and must resolve to `listings.slug`. The trap: `campaign_drafts.final_url` defaults to `https://www.gentlespacesolutions.com/spaces`, the *index* page (BD4). That URL must resolve to **no listing**. If it resolved to something, every campaign-sourced enquiry would acquire a fabricated listing, and from it a fabricated corridor — the exact failure this plan exists to prevent.

`public.corridors` is shared reference data, deliberately not `org_id`-scoped and therefore not RLS-protected (data model §4). `listCorridors` still takes `scope` first because the Global Constraints require it of every data-layer function, and the comment records why no clause is applied — a reviewer must be able to see that the omission is deliberate rather than missed.

- [ ] **Step 1: Write the failing tests**

```ts
// ads-agent/lib/attribution/listing-url.test.ts
import { describe, it, expect } from "vitest";
import { listingSlugFromUrl } from "./listing-url";

describe("listingSlugFromUrl", () => {
  it("extracts the slug from a canonical listing URL", () => {
    expect(listingSlugFromUrl("https://www.gentlespacesolutions.com/spaces/wework-hsr-layout")).toBe(
      "wework-hsr-layout",
    );
  });

  it("ignores a query string and a fragment", () => {
    expect(
      listingSlugFromUrl("https://www.gentlespacesolutions.com/spaces/awfis-koramangala?utm_source=g#pricing"),
    ).toBe("awfis-koramangala");
  });

  it("ignores a trailing slash", () => {
    expect(listingSlugFromUrl("https://www.gentlespacesolutions.com/spaces/indiqube-orr/")).toBe(
      "indiqube-orr",
    );
  });

  it("returns null for the /spaces index — the campaign default final_url", () => {
    // BD4: campaign_drafts.final_url defaults to the index. Resolving it to a listing would
    // give every campaign-sourced enquiry a fabricated listing and corridor.
    expect(listingSlugFromUrl("https://www.gentlespacesolutions.com/spaces")).toBeNull();
    expect(listingSlugFromUrl("https://www.gentlespacesolutions.com/spaces/")).toBeNull();
  });

  it("returns null for a path that is not a listing", () => {
    expect(listingSlugFromUrl("https://www.gentlespacesolutions.com/about")).toBeNull();
    expect(listingSlugFromUrl("https://www.gentlespacesolutions.com/")).toBeNull();
  });

  it("returns null for a nested path below a listing rather than guessing the parent", () => {
    expect(listingSlugFromUrl("https://www.gentlespacesolutions.com/spaces/hsr/gallery")).toBeNull();
  });

  it("returns null for junk instead of throwing", () => {
    expect(listingSlugFromUrl("not a url")).toBeNull();
    expect(listingSlugFromUrl("")).toBeNull();
  });
});
```

```ts
// ads-agent/lib/db/corridors.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));
vi.mock("./scope-sql", () => ({
  scopeClause: (scope: { kind: string; orgId: string }, column = "org_id") =>
    scope.kind === "platform"
      ? { sql: "TRUE", params: [] }
      : { sql: `${column} = $1`, params: [scope.orgId] },
}));

const ORG = "66666666-6666-6666-6666-666666666666";
const SCOPE = { kind: "org" as const, orgId: ORG };

beforeEach(() => query.mockReset());

describe("listCorridors", () => {
  it("reads the shared vocabulary and maps it to camelCase", async () => {
    query.mockResolvedValue({
      rows: [
        { id: "c1", slug: "hsr-layout", display_name: "HSR Layout", city: "Bangalore", parent_id: null },
      ],
    });
    const { listCorridors } = await import("./corridors");
    expect(await listCorridors(SCOPE)).toEqual([
      { id: "c1", slug: "hsr-layout", displayName: "HSR Layout", city: "Bangalore", parentId: null },
    ]);
    expect(query.mock.calls[0][0]).toContain("FROM public.corridors");
  });
});

describe("corridorListingIds", () => {
  it("scopes the listing side and filters by corridor", async () => {
    query.mockResolvedValue({ rows: [{ listing_id: "l1" }, { listing_id: "l2" }] });
    const { corridorListingIds } = await import("./corridors");
    expect(await corridorListingIds(SCOPE, "c1")).toEqual(["l1", "l2"]);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("FROM listings.listing_corridors");
    expect(sql).toContain("l.org_id = $1");
    expect(params).toEqual([ORG, "c1"]);
  });
});

describe("resolveEnquiryListings", () => {
  it("resolves listing_id and corridor_id from listing_url within scope", async () => {
    query.mockResolvedValue({ rowCount: 3 });
    const { resolveEnquiryListings } = await import("./corridors");
    expect(await resolveEnquiryListings(SCOPE, 500)).toBe(3);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("UPDATE adsagent.enquiries");
    expect(sql).toContain("org_id = $1");
    // The index page must never resolve to a listing.
    expect(sql).toContain("'/spaces/%'");
    expect(params).toEqual([ORG, 500]);
  });

  it("rejects a non-positive batch size", async () => {
    const { resolveEnquiryListings } = await import("./corridors");
    await expect(resolveEnquiryListings(SCOPE, 0)).rejects.toThrow(/limit/);
  });
});

describe("countUnresolvedEnquiries", () => {
  it("counts enquiries with no listing so the gap is a figure, not a silence", async () => {
    query.mockResolvedValue({ rows: [{ count: "12" }] });
    const { countUnresolvedEnquiries } = await import("./corridors");
    expect(await countUnresolvedEnquiries(SCOPE)).toBe(12);
    expect(query.mock.calls[0][0]).toContain("listing_id IS NULL");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ads-agent && npx vitest run lib/attribution/listing-url.test.ts lib/db/corridors.test.ts`
Expected: FAIL — two unresolved imports.

- [ ] **Step 3: Write `listing-url.ts`**

```ts
// ads-agent/lib/attribution/listing-url.ts

/** Resolves a captured listing URL to a listing slug, or null when it names no listing.
 *
 *  `/spaces` — the index — must return null. It is the default `campaign_drafts.final_url`
 *  (BD4), so resolving it would give every campaign-sourced enquiry a fabricated listing and,
 *  through the listing, a fabricated corridor. */
export function listingSlugFromUrl(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }

  const segments = pathname.split("/").filter((s) => s.length > 0);
  if (segments.length !== 2) return null;      // `/spaces` alone, or anything deeper
  if (segments[0] !== "spaces") return null;
  return decodeURIComponent(segments[1]);
}
```

- [ ] **Step 4: Write `corridors.ts`**

```ts
// ads-agent/lib/db/corridors.ts
import { getPool } from "./client";
import { scopeClause, type Scope } from "./scope-sql";

export type Corridor = {
  id: string;
  slug: string;
  displayName: string;
  city: string;
  parentId: string | null;
};

type CorridorSqlRow = {
  id: string;
  slug: string;
  display_name: string;
  city: string;
  parent_id: string | null;
};

/** `scope` is required by the data-layer contract but applies no clause here:
 *  public.corridors is shared reference data, deliberately not org-scoped and therefore not
 *  RLS-protected (data model §4). The omission is deliberate, not missed. */
export async function listCorridors(scope: Scope): Promise<Corridor[]> {
  void scope;
  const { rows } = await getPool().query<CorridorSqlRow>(
    `SELECT id, slug, display_name, city, parent_id
       FROM public.corridors
      ORDER BY display_name ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    displayName: r.display_name,
    city: r.city,
    parentId: r.parent_id,
  }));
}

export async function corridorListingIds(scope: Scope, corridorId: string): Promise<string[]> {
  const s = scopeClause(scope, "l.org_id");
  const { rows } = await getPool().query<{ listing_id: string }>(
    `SELECT lc.listing_id
       FROM listings.listing_corridors lc
       JOIN listings.listings l ON l.id = lc.listing_id
      WHERE ${s.sql}
        AND lc.corridor_id = $${s.params.length + 1}
      ORDER BY lc.listing_id ASC`,
    [...s.params, corridorId],
  );
  return rows.map((r) => r.listing_id);
}

/** Resolves `listing_url` to `listing_id`, and the listing's highest-confidence corridor to
 *  `corridor_id`. Returns the number of enquiries resolved. Batched so a large backlog does
 *  not hold one long transaction. */
export async function resolveEnquiryListings(scope: Scope, limit: number): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`limit must be a positive integer, got ${limit}`);
  const s = scopeClause(scope, "org_id");
  const result = await getPool().query(
    `WITH candidate AS (
        SELECT id, listing_url
          FROM adsagent.enquiries
         WHERE ${s.sql}
           AND listing_id IS NULL
           AND lifecycle = 'active'
           AND listing_url LIKE '%/spaces/%'
         ORDER BY first_seen_at ASC
         LIMIT $${s.params.length + 1}
     ),
     matched AS (
        SELECT c.id AS enquiry_id, l.id AS listing_id
          FROM candidate c
          JOIN listings.listings l
            -- split_part on the path segment after /spaces/, stripped of query and fragment
            ON l.slug = split_part(
                          split_part(
                            split_part(c.listing_url, '/spaces/', 2), '?', 1
                          ), '#', 1
                        )
     )
     UPDATE adsagent.enquiries e
        SET listing_id  = m.listing_id,
            corridor_id = (
              SELECT lc.corridor_id
                FROM listings.listing_corridors lc
               WHERE lc.listing_id = m.listing_id
               ORDER BY lc.confidence DESC, lc.corridor_id ASC
               LIMIT 1
            ),
            updated_at  = now()
       FROM matched m
      WHERE e.id = m.enquiry_id`,
    [...s.params, limit],
  );
  return result.rowCount ?? 0;
}

export async function countUnresolvedEnquiries(scope: Scope): Promise<number> {
  const s = scopeClause(scope, "org_id");
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT COUNT(*) AS count
       FROM adsagent.enquiries
      WHERE ${s.sql}
        AND listing_id IS NULL
        AND lifecycle = 'active'`,
    s.params,
  );
  return Number(rows[0].count);
}
```

Note the trailing-slash case: `listing_url LIKE '%/spaces/%'` admits `/spaces/` itself, whose `split_part` yields the empty string, which matches no `listings.slug` because that column is `NOT NULL UNIQUE` and never empty. The index page therefore resolves to nothing, matching `listingSlugFromUrl`.

- [ ] **Step 5: Run them and watch them pass**

Run: `cd ads-agent && npx vitest run lib/attribution/listing-url.test.ts lib/db/corridors.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 6: Verify the resolution SQL against the real database**

```bash
cd ads-agent
psql "$DATABASE_URL" -c "SELECT count(*) FILTER (WHERE listing_id IS NOT NULL) AS resolved, count(*) FILTER (WHERE listing_id IS NULL) AS unresolved FROM adsagent.enquiries WHERE lifecycle = 'active'"
```

Expected: two counts. Both are legitimate figures; a non-zero `unresolved` is the honest mapping gap, and Task 9 renders it.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/attribution/listing-url.ts ads-agent/lib/attribution/listing-url.test.ts \
        ads-agent/lib/db/corridors.ts ads-agent/lib/db/corridors.test.ts
git commit -m "feat(attribution): resolve enquiries to listings and corridors

The /spaces index -- the default campaign final_url -- resolves to no
listing. Resolving it would give every campaign-sourced enquiry a
fabricated listing and, through it, a fabricated corridor."
```

---

# Wave 3

## Task 8 (fan-in): The rebuild job and the quarantine writer

**Files:**
- Create: `ads-agent/lib/db/attribution.ts`
- Test: `ads-agent/lib/db/attribution.test.ts`
- Create: `ads-agent/lib/attribution/rebuild.ts`
- Test: `ads-agent/lib/attribution/rebuild.test.ts`

**Skills:** `senior-data-engineer`, `senior-backend`, `tdd-guide`
**Model:** `inherit` — this is where the frozen-window rule, the freshness rule and the conservation assertion meet.

**Interfaces:**
- Consumes: `AttributionWindow`, `WindowState`, `windowState`, `trailingWindow` from `../attribution/window`; `reconcile`, `assertConserved`, `applyFrozenWindow`, `AttributionResult` from `../attribution/reconcile`; `AnalyticalQuery`, `fetchCorridorSpend`, `fetchCorridorEnquiries`, `fetchSourceWatermark` from `../attribution/analytical-source`; `freshness`, `AttributionFreshness` from `../attribution/freshness`; `type Authority` from `../attribution/quarantine`; `Scope`, `scopeClause` from `./scope-sql`; `getPool` from `./client`; the tables from migration 074.
- Produces:
  - `type StoredCorridorAttribution = CorridorAttribution & { authority: Authority }`
  - `type StoredAttribution = { window: AttributionWindow; windowState: WindowState; corridors: StoredCorridorAttribution[]; residual: AttributionResidual; lateEnquiryCount: number; totals: { spendInr: number; enquiryCount: number }; freshness: AttributionFreshness; authority: Authority }`
  - `function writeAttribution(scope: Scope, result: AttributionResult, f: AttributionFreshness): Promise<void>`
  - `function readAttribution(scope: Scope, w: AttributionWindow): Promise<StoredAttribution | null>`
  - `function rebuildAttribution(scope: Scope, deps: { query: AnalyticalQuery; window: AttributionWindow; now: Date }): Promise<AttributionResult>`

  Tasks 9 and 10 import `readAttribution` and `StoredAttribution`.

**Context:** three rules converge here.

1. **Conservation.** `writeAttribution` calls `assertConserved` before it issues a single `INSERT`. A fabricated result never reaches the database, and if it somehow does, migration 074's `CHECK` rejects it.
2. **Freshness.** Every written row carries `computed_at`, `source_watermark` and `cdc_lag_seconds`, so a stale number can say so (datastore §12.1). `rebuildAttribution` does **not** refuse on staleness — a stale figure is still worth showing, labelled. `assertFreshEnoughToSpend` is the guard for anything that changes spend, and that call site belongs to S11.
3. **Frozen windows.** If the window is `closed` and a row already exists, the stored figures win and only `late_enquiry_count` moves.

The whole write is one transaction, using an explicit client so `set_tenant` is transaction-scoped as the Global Constraints require. Without the third argument to `set_config`, the pooled connection carries the tenant into the next request.

- [ ] **Step 1: Write the failing test for the writer**

```ts
// ads-agent/lib/db/attribution.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const clientQuery = vi.fn();
const release = vi.fn();
const poolQuery = vi.fn();
vi.mock("./client", () => ({
  getPool: () => ({
    query: poolQuery,
    connect: async () => ({ query: clientQuery, release }),
  }),
}));
vi.mock("./scope-sql", () => ({
  scopeClause: (scope: { kind: string; orgId: string }, column = "org_id") =>
    scope.kind === "platform"
      ? { sql: "TRUE", params: [] }
      : { sql: `${column} = $1`, params: [scope.orgId] },
}));

import { reconcile } from "../attribution/reconcile";
import { freshness } from "../attribution/freshness";

const ORG = "77777777-7777-7777-7777-777777777777";
const SCOPE = { kind: "org" as const, orgId: ORG };
const WINDOW = { startDate: "2026-08-01", endDate: "2026-08-07" };
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const FRESH = freshness(new Date("2026-08-12T10:01:00Z"), new Date("2026-08-12T10:00:00Z"));

const RESULT = reconcile({
  window: WINDOW,
  windowState: "open",
  spend: [
    { corridorId: A, spendInr: 1000 },
    { corridorId: null, spendInr: 600 },
  ],
  enquiries: [
    { corridorId: A, enquiryCount: 4 },
    { corridorId: null, enquiryCount: 2 },
  ],
});

beforeEach(() => {
  clientQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  poolQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  release.mockReset();
});

describe("writeAttribution", () => {
  it("sets the tenant transaction-scoped, inside the transaction", async () => {
    const { writeAttribution } = await import("./attribution");
    await writeAttribution(SCOPE, RESULT, FRESH);

    const statements = clientQuery.mock.calls.map((c) => String(c[0]));
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toContain("public.set_tenant");
    expect(statements.at(-1)).toBe("COMMIT");
    expect(clientQuery.mock.calls[1][1]).toEqual([ORG]);
  });

  it("writes one row per corridor plus the named unattributed bucket", async () => {
    const { writeAttribution } = await import("./attribution");
    await writeAttribution(SCOPE, RESULT, FRESH);

    const inserts = clientQuery.mock.calls.filter((c) =>
      String(c[0]).includes("derived.corridor_attribution_daily"),
    );
    expect(inserts).toHaveLength(2);
    const corridorIds = inserts.map((c) => (c[1] as unknown[])[1]);
    expect(corridorIds).toContain(A);
    expect(corridorIds).toContain(null);
  });

  it("writes the reconciliation row with the residual figures", async () => {
    const { writeAttribution } = await import("./attribution");
    await writeAttribution(SCOPE, RESULT, FRESH);

    const [sql, params] = clientQuery.mock.calls.find((c) =>
      String(c[0]).includes("derived.attribution_reconciliation"),
    )!;
    expect(sql).toContain("unattributed_spend_inr");
    expect(params).toContain(600);
    expect(params).toContain(2);
  });

  it("refuses to write a fabricated result and rolls back", async () => {
    const fabricated = {
      ...RESULT,
      corridors: [{ ...RESULT.corridors[0], spendInr: 1600, costPerEnquiryInr: 400 }],
    };
    const { writeAttribution } = await import("./attribution");
    await expect(writeAttribution(SCOPE, fabricated, FRESH)).rejects.toThrow(/not conserved/);

    const statements = clientQuery.mock.calls.map((c) => String(c[0]));
    expect(statements).not.toContain("COMMIT");
  });

  it("releases the client even when the write throws", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes("INSERT")) throw new Error("boom");
      return { rows: [], rowCount: 0 };
    });
    const { writeAttribution } = await import("./attribution");
    await expect(writeAttribution(SCOPE, RESULT, FRESH)).rejects.toThrow("boom");
    expect(release).toHaveBeenCalled();
    expect(clientQuery.mock.calls.map((c) => String(c[0]))).toContain("ROLLBACK");
  });
});

describe("readAttribution", () => {
  it("tags everything it returns as derived authority", async () => {
    poolQuery
      .mockResolvedValueOnce({
        rows: [
          {
            corridor_id: A,
            spend_inr: "1000",
            enquiry_count: 4,
            cost_per_enquiry_inr: "250",
            late_enquiry_count: 0,
            window_state: "open",
            computed_at: new Date("2026-08-12T10:01:00Z"),
            source_watermark: new Date("2026-08-12T10:00:00Z"),
            cdc_lag_seconds: 60,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            total_spend_inr: "1600",
            total_enquiry_count: 6,
            unattributed_spend_inr: "600",
            unattributed_enquiry_count: 2,
            spend_without_enquiries_inr: "0",
            enquiries_without_spend_count: 0,
            late_enquiry_count: 0,
          },
        ],
      });

    const { readAttribution } = await import("./attribution");
    const stored = await readAttribution(SCOPE, WINDOW);

    expect(stored!.authority).toBe("derived");
    expect(stored!.corridors[0].authority).toBe("derived");
    expect(stored!.corridors[0].costPerEnquiryInr).toBe(250);
    expect(stored!.residual.unattributedSpendInr).toBe(600);
    expect(stored!.freshness.cdcLagSeconds).toBe(60);
    expect(stored!.freshness.isStale).toBe(false);
  });

  it("returns null when the window has never been computed, rather than zeroes", async () => {
    // Zeroes would render as "₹0 spend, 0 enquiries" -- indistinguishable from a real
    // quiet week, which is a fabricated answer to a question we have not asked yet.
    poolQuery.mockResolvedValue({ rows: [] });
    const { readAttribution } = await import("./attribution");
    expect(await readAttribution(SCOPE, WINDOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/attribution.test.ts`
Expected: FAIL — `Failed to resolve import "./attribution"`.

- [ ] **Step 3: Write `lib/db/attribution.ts`**

```ts
// ads-agent/lib/db/attribution.ts
import {
  assertConserved,
  type AttributionResidual,
  type AttributionResult,
  type CorridorAttribution,
} from "../attribution/reconcile";
import { freshness, type AttributionFreshness } from "../attribution/freshness";
import type { Authority } from "../attribution/quarantine";
import type { AttributionWindow, WindowState } from "../attribution/window";
import { getPool } from "./client";
import { scopeClause, type Scope } from "./scope-sql";

export type StoredCorridorAttribution = CorridorAttribution & { authority: Authority };

export type StoredAttribution = {
  window: AttributionWindow;
  windowState: WindowState;
  corridors: StoredCorridorAttribution[];
  residual: AttributionResidual;
  lateEnquiryCount: number;
  totals: { spendInr: number; enquiryCount: number };
  freshness: AttributionFreshness;
  authority: Authority;
};

type CorridorSqlRow = {
  corridor_id: string | null;
  spend_inr: string;
  enquiry_count: number;
  cost_per_enquiry_inr: string | null;
  late_enquiry_count: number;
  window_state: WindowState;
  computed_at: Date;
  source_watermark: Date;
  cdc_lag_seconds: number;
};

type ReconciliationSqlRow = {
  total_spend_inr: string;
  total_enquiry_count: number;
  unattributed_spend_inr: string;
  unattributed_enquiry_count: number;
  spend_without_enquiries_inr: string;
  enquiries_without_spend_count: number;
  late_enquiry_count: number;
};

export async function writeAttribution(
  scope: Scope,
  result: AttributionResult,
  f: AttributionFreshness,
): Promise<void> {
  // Nothing fabricated reaches the database. Migration 074's CHECK is the second line.
  assertConserved(result);

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Third argument true inside set_tenant: transaction-scoped, so the pooled connection
    // does not carry this tenant into the next request.
    await client.query("SELECT public.set_tenant($1)", [scope.orgId]);

    const rows: { corridorId: string | null; spendInr: number; enquiryCount: number; costPerEnquiryInr: number | null }[] = [
      ...result.corridors,
      // The unattributed bucket is a row with a NULL corridor, not a hidden remainder.
      {
        corridorId: null,
        spendInr: result.residual.unattributedSpendInr,
        enquiryCount: result.residual.unattributedEnquiryCount,
        costPerEnquiryInr:
          result.residual.unattributedEnquiryCount > 0
            ? result.residual.unattributedSpendInr / result.residual.unattributedEnquiryCount
            : null,
      },
    ];

    for (const row of rows) {
      await client.query(
        `INSERT INTO derived.corridor_attribution_daily
           (org_id, corridor_id, window_start, window_end, window_state,
            spend_inr, enquiry_count, cost_per_enquiry_inr, late_enquiry_count,
            computed_at, source_watermark, cdc_lag_seconds)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (org_id, corridor_id, window_start, window_end) DO UPDATE SET
           window_state         = EXCLUDED.window_state,
           spend_inr            = EXCLUDED.spend_inr,
           enquiry_count        = EXCLUDED.enquiry_count,
           cost_per_enquiry_inr = EXCLUDED.cost_per_enquiry_inr,
           late_enquiry_count   = EXCLUDED.late_enquiry_count,
           computed_at          = EXCLUDED.computed_at,
           source_watermark     = EXCLUDED.source_watermark,
           cdc_lag_seconds      = EXCLUDED.cdc_lag_seconds`,
        [
          scope.orgId,
          row.corridorId,
          result.window.startDate,
          result.window.endDate,
          result.windowState,
          row.spendInr,
          row.enquiryCount,
          row.costPerEnquiryInr,
          result.lateEnquiryCount,
          f.computedAt,
          f.sourceWatermark,
          f.cdcLagSeconds,
        ],
      );
    }

    await client.query(
      `INSERT INTO derived.attribution_reconciliation
         (org_id, window_start, window_end, window_state,
          total_spend_inr, total_enquiry_count,
          unattributed_spend_inr, unattributed_enquiry_count,
          spend_without_enquiries_inr, enquiries_without_spend_count,
          late_enquiry_count, computed_at, source_watermark, cdc_lag_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (org_id, window_start, window_end) DO UPDATE SET
         window_state                  = EXCLUDED.window_state,
         total_spend_inr               = EXCLUDED.total_spend_inr,
         total_enquiry_count           = EXCLUDED.total_enquiry_count,
         unattributed_spend_inr        = EXCLUDED.unattributed_spend_inr,
         unattributed_enquiry_count    = EXCLUDED.unattributed_enquiry_count,
         spend_without_enquiries_inr   = EXCLUDED.spend_without_enquiries_inr,
         enquiries_without_spend_count = EXCLUDED.enquiries_without_spend_count,
         late_enquiry_count            = EXCLUDED.late_enquiry_count,
         computed_at                   = EXCLUDED.computed_at,
         source_watermark              = EXCLUDED.source_watermark,
         cdc_lag_seconds               = EXCLUDED.cdc_lag_seconds`,
      [
        scope.orgId,
        result.window.startDate,
        result.window.endDate,
        result.windowState,
        result.totals.spendInr,
        result.totals.enquiryCount,
        result.residual.unattributedSpendInr,
        result.residual.unattributedEnquiryCount,
        result.residual.spendWithoutEnquiriesInr,
        result.residual.enquiriesWithoutSpendCount,
        result.lateEnquiryCount,
        f.computedAt,
        f.sourceWatermark,
        f.cdcLagSeconds,
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

export async function readAttribution(
  scope: Scope,
  w: AttributionWindow,
): Promise<StoredAttribution | null> {
  const s = scopeClause(scope, "org_id");
  const n = s.params.length;

  const corridorResult = await getPool().query<CorridorSqlRow>(
    `SELECT corridor_id, spend_inr, enquiry_count, cost_per_enquiry_inr, late_enquiry_count,
            window_state, computed_at, source_watermark, cdc_lag_seconds
       FROM derived.corridor_attribution_daily
      WHERE ${s.sql} AND window_start = $${n + 1} AND window_end = $${n + 2}
      ORDER BY spend_inr DESC`,
    [...s.params, w.startDate, w.endDate],
  );
  if (corridorResult.rows.length === 0) return null;

  const reconciliationResult = await getPool().query<ReconciliationSqlRow>(
    `SELECT total_spend_inr, total_enquiry_count,
            unattributed_spend_inr, unattributed_enquiry_count,
            spend_without_enquiries_inr, enquiries_without_spend_count, late_enquiry_count
       FROM derived.attribution_reconciliation
      WHERE ${s.sql} AND window_start = $${n + 1} AND window_end = $${n + 2}`,
    [...s.params, w.startDate, w.endDate],
  );
  const r = reconciliationResult.rows[0];
  if (!r) return null;

  const head = corridorResult.rows[0];
  return {
    window: w,
    windowState: head.window_state,
    // The NULL-corridor row is the residual and is reported through `residual`, not as a corridor.
    corridors: corridorResult.rows
      .filter((row) => row.corridor_id !== null)
      .map((row) => ({
        corridorId: row.corridor_id as string,
        spendInr: Number(row.spend_inr),
        enquiryCount: row.enquiry_count,
        costPerEnquiryInr: row.cost_per_enquiry_inr === null ? null : Number(row.cost_per_enquiry_inr),
        authority: "derived" as const,
      })),
    residual: {
      unattributedSpendInr: Number(r.unattributed_spend_inr),
      unattributedEnquiryCount: r.unattributed_enquiry_count,
      spendWithoutEnquiriesInr: Number(r.spend_without_enquiries_inr),
      enquiriesWithoutSpendCount: r.enquiries_without_spend_count,
    },
    lateEnquiryCount: r.late_enquiry_count,
    totals: { spendInr: Number(r.total_spend_inr), enquiryCount: r.total_enquiry_count },
    freshness: freshness(head.computed_at, head.source_watermark),
    authority: "derived",
  };
}
```

- [ ] **Step 4: Run the writer test and watch it pass**

Run: `cd ads-agent && npx vitest run lib/db/attribution.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Write the failing test for the rebuild job**

```ts
// ads-agent/lib/attribution/rebuild.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const writeAttribution = vi.fn();
const readAttribution = vi.fn();
vi.mock("../db/attribution", () => ({ writeAttribution, readAttribution }));

import { corridorEnquirySql, corridorSpendSql, sourceWatermarkSql } from "./analytical-source";
import { rebuildAttribution } from "./rebuild";

const ORG = "88888888-8888-8888-8888-888888888888";
const SCOPE = { kind: "org" as const, orgId: ORG };
const WINDOW = { startDate: "2026-08-01", endDate: "2026-08-07" };
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function fakeQuery(opts: { spend: unknown[]; enquiries: unknown[]; watermark: string }) {
  return vi.fn(async (sql: string) => {
    if (sql === corridorSpendSql()) return opts.spend;
    if (sql === corridorEnquirySql()) return opts.enquiries;
    if (sql === sourceWatermarkSql()) return [{ watermark: opts.watermark }];
    throw new Error(`unexpected sql: ${sql}`);
  });
}

beforeEach(() => {
  writeAttribution.mockReset().mockResolvedValue(undefined);
  readAttribution.mockReset().mockResolvedValue(null);
});

describe("rebuildAttribution on an open window", () => {
  it("reconciles the mirror and writes the result with its freshness", async () => {
    const query = fakeQuery({
      spend: [
        { corridor_id: A, spend_inr: "1000" },
        { corridor_id: null, spend_inr: "600" },
      ],
      enquiries: [{ corridor_id: A, enquiry_count: "4" }],
      watermark: "2026-08-12 09:59:00.000",
    });

    const result = await rebuildAttribution(SCOPE, {
      query: query as never,
      window: WINDOW,
      now: new Date("2026-08-12T10:00:00Z"),
    });

    expect(result.windowState).toBe("open");
    expect(result.corridors[0]).toEqual({
      corridorId: A,
      spendInr: 1000,
      enquiryCount: 4,
      costPerEnquiryInr: 250,
    });
    expect(result.residual.unattributedSpendInr).toBe(600);

    const [, written, f] = writeAttribution.mock.calls[0];
    expect(written).toEqual(result);
    expect(f.cdcLagSeconds).toBe(60);
    expect(f.isStale).toBe(false);
  });

  it("still writes when the mirror is stale, labelled rather than suppressed", async () => {
    const query = fakeQuery({
      spend: [{ corridor_id: A, spend_inr: "1000" }],
      enquiries: [{ corridor_id: A, enquiry_count: "4" }],
      watermark: "2026-08-12 08:00:00.000",
    });

    await rebuildAttribution(SCOPE, {
      query: query as never,
      window: WINDOW,
      now: new Date("2026-08-12T10:00:00Z"),
    });

    const [, , f] = writeAttribution.mock.calls[0];
    expect(f.cdcLagSeconds).toBe(7200);
    expect(f.isStale).toBe(true);
    expect(writeAttribution).toHaveBeenCalledTimes(1);
  });
});

describe("rebuildAttribution on a closed window", () => {
  const CLOSED = { startDate: "2026-07-01", endDate: "2026-07-07" };

  it("keeps the frozen figures and records the late arrivals", async () => {
    readAttribution.mockResolvedValue({
      window: CLOSED,
      windowState: "closed",
      corridors: [
        { corridorId: A, spendInr: 1000, enquiryCount: 4, costPerEnquiryInr: 250, authority: "derived" },
      ],
      residual: {
        unattributedSpendInr: 0,
        unattributedEnquiryCount: 0,
        spendWithoutEnquiriesInr: 0,
        enquiriesWithoutSpendCount: 0,
      },
      lateEnquiryCount: 0,
      totals: { spendInr: 1000, enquiryCount: 4 },
      freshness: {
        computedAt: "2026-07-08T00:00:00.000Z",
        sourceWatermark: "2026-07-08T00:00:00.000Z",
        cdcLagSeconds: 0,
        isStale: false,
      },
      authority: "derived",
    });

    const query = fakeQuery({
      spend: [{ corridor_id: A, spend_inr: "1000" }],
      enquiries: [{ corridor_id: A, enquiry_count: "9" }],
      watermark: "2026-08-12 09:59:00.000",
    });

    const result = await rebuildAttribution(SCOPE, {
      query: query as never,
      window: CLOSED,
      now: new Date("2026-08-12T10:00:00Z"),
    });

    expect(result.corridors[0].enquiryCount).toBe(4);
    expect(result.corridors[0].costPerEnquiryInr).toBe(250);
    expect(result.lateEnquiryCount).toBe(5);
  });

  it("computes from scratch when a closed window has never been stored", async () => {
    readAttribution.mockResolvedValue(null);
    const query = fakeQuery({
      spend: [{ corridor_id: A, spend_inr: "800" }],
      enquiries: [{ corridor_id: A, enquiry_count: "2" }],
      watermark: "2026-08-12 09:59:00.000",
    });

    const result = await rebuildAttribution(SCOPE, {
      query: query as never,
      window: CLOSED,
      now: new Date("2026-08-12T10:00:00Z"),
    });

    expect(result.corridors[0].costPerEnquiryInr).toBe(400);
    expect(result.lateEnquiryCount).toBe(0);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/attribution/rebuild.test.ts`
Expected: FAIL — `Failed to resolve import "./rebuild"`.

- [ ] **Step 7: Write `rebuild.ts`**

```ts
// ads-agent/lib/attribution/rebuild.ts
import { readAttribution, writeAttribution } from "../db/attribution";
import type { Scope } from "../db/scope-sql";
import {
  fetchCorridorEnquiries,
  fetchCorridorSpend,
  fetchSourceWatermark,
  type AnalyticalQuery,
} from "./analytical-source";
import { freshness } from "./freshness";
import { applyFrozenWindow, reconcile, type AttributionResult } from "./reconcile";
import { windowState, type AttributionWindow } from "./window";

export async function rebuildAttribution(
  scope: Scope,
  deps: { query: AnalyticalQuery; window: AttributionWindow; now: Date },
): Promise<AttributionResult> {
  const state = windowState(deps.window, deps.now);

  const [watermark, spend, enquiries] = await Promise.all([
    fetchSourceWatermark(scope, deps.query),
    fetchCorridorSpend(scope, deps.query, deps.window),
    fetchCorridorEnquiries(scope, deps.query, deps.window),
  ]);

  const fresh = reconcile({ window: deps.window, windowState: state, spend, enquiries });

  let result = fresh;
  if (state === "closed") {
    const stored = await readAttribution(scope, deps.window);
    if (stored) {
      // A closed window's figures are frozen. The delta becomes lateEnquiryCount rather
      // than silently re-deriving a historical cost.
      const frozen: AttributionResult = {
        window: stored.window,
        windowState: "closed",
        corridors: stored.corridors.map(({ authority, ...c }) => c),
        residual: stored.residual,
        lateEnquiryCount: stored.lateEnquiryCount,
        totals: stored.totals,
      };
      result = applyFrozenWindow(frozen, fresh);
    }
  }

  // A stale figure is still written, carrying its lag. Suppressing it would leave the
  // dashboard showing nothing, which reads as "no spend" -- worse than a labelled number.
  const f = freshness(deps.now, watermark);
  await writeAttribution(scope, result, f);
  return result;
}
```

- [ ] **Step 8: Run both tests and watch them pass**

Run: `cd ads-agent && npx vitest run lib/attribution/rebuild.test.ts lib/db/attribution.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 9: Commit**

```bash
git add ads-agent/lib/db/attribution.ts ads-agent/lib/db/attribution.test.ts \
        ads-agent/lib/attribution/rebuild.ts ads-agent/lib/attribution/rebuild.test.ts
git commit -m "feat(attribution): rebuild the rollup into the derived quarantine

Conservation is asserted before any INSERT, every row carries its CDC lag,
and a closed window's figures are frozen with late arrivals counted
separately rather than folded into the cost."
```

---

# Wave 4

## Task 9: Dashboard surfaces (D4, D6, and backend spec §6)

**Files:**
- Modify: `ads-agent/lib/db/dashboard.ts:1-101`
- Modify: `ads-agent/lib/db/dashboard.test.ts`
- Modify: `ads-agent/app/(admin)/page.tsx:1-69`

**Skills:** `frontend-developer`, `typescript-pro`
**Model:** `composer-2.5-fast` — every diff is written out below.

**Interfaces:**
- Consumes: `readAttribution`, `type StoredAttribution` from `./attribution` (Task 8); `trailingWindow` from `../attribution/window` (Task 2); `orgScopeFromSession` from `../attribution/org-scope` (Task 3); `listCorridors` from `./corridors` (Task 7); `Scope` from `./scope-sql` (S3).
- Produces: `type CorridorCostRow`, `function getCorridorCosts(scope: Scope, days: number, now: Date): Promise<CorridorCostSummary | null>`; `OverviewStats` gains `costPerEnquiryInr: number | null` and `attributionIsStale: boolean`.

**Context:** `getOverviewStats` already returns `blendedCplInr`, computed as month spend over `performance_snapshots.conversions` — the ad platform's own conversion count. That is a **different number** from cost per enquiry over enquiries we hold, and this task keeps both rather than replacing one with the other, because collapsing them would make provenance unrecoverable. The field names say which is which.

`listCampaignsWithLatestCpl` currently selects `c.corridor`, the dead TEXT column. It is repointed at `public.corridors.display_name` via `corridor_id`, so the displayed corridor is the controlled vocabulary rather than free text. The return type keeps the field name `corridor`, so `app/(admin)/campaigns/page.tsx` and `components/SpendCplChart.tsx` need no change.

Backend spec §6 says My spaces "shows ₹840 each per space… Either label it or show corridor cost plus per-space counts." The page renders corridor cost plus the residual; the labelled per-space estimate is Task 10's tool, consumed by the generative surfaces at S13.

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/db/dashboard.test.ts — append these blocks
import { describe, it, expect, vi, beforeEach } from "vitest";

const readAttribution = vi.fn();
const listCorridors = vi.fn();
vi.mock("./attribution", () => ({ readAttribution }));
vi.mock("./corridors", () => ({ listCorridors }));

const ORG = "99999999-9999-9999-9999-999999999999";
const SCOPE = { kind: "org" as const, orgId: ORG };
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const NOW = new Date("2026-08-12T08:00:00Z");

beforeEach(() => {
  readAttribution.mockReset();
  listCorridors.mockReset().mockResolvedValue([
    { id: A, slug: "hsr-layout", displayName: "HSR Layout", city: "Bangalore", parentId: null },
  ]);
});

describe("getCorridorCosts", () => {
  it("joins the stored rollup to corridor display names and carries the residual", async () => {
    readAttribution.mockResolvedValue({
      window: { startDate: "2026-08-06", endDate: "2026-08-12" },
      windowState: "open",
      corridors: [
        { corridorId: A, spendInr: 1000, enquiryCount: 4, costPerEnquiryInr: 250, authority: "derived" },
      ],
      residual: {
        unattributedSpendInr: 600,
        unattributedEnquiryCount: 2,
        spendWithoutEnquiriesInr: 0,
        enquiriesWithoutSpendCount: 0,
      },
      lateEnquiryCount: 0,
      totals: { spendInr: 1600, enquiryCount: 6 },
      freshness: {
        computedAt: "2026-08-12T07:59:00.000Z",
        sourceWatermark: "2026-08-12T07:58:00.000Z",
        cdcLagSeconds: 60,
        isStale: false,
      },
      authority: "derived",
    });

    const { getCorridorCosts } = await import("./dashboard");
    const summary = await getCorridorCosts(SCOPE, 7, NOW);

    expect(readAttribution).toHaveBeenCalledWith(SCOPE, {
      startDate: "2026-08-06",
      endDate: "2026-08-12",
    });
    expect(summary!.rows).toEqual([
      {
        corridorId: A,
        corridorName: "HSR Layout",
        spendInr: 1000,
        enquiryCount: 4,
        costPerEnquiryInr: 250,
        authority: "derived",
      },
    ]);
    expect(summary!.residual.unattributedSpendInr).toBe(600);
    expect(summary!.isStale).toBe(false);
  });

  it("shows a corridor whose id has no vocabulary row without inventing a name", async () => {
    listCorridors.mockResolvedValue([]);
    readAttribution.mockResolvedValue({
      window: { startDate: "2026-08-06", endDate: "2026-08-12" },
      windowState: "open",
      corridors: [
        { corridorId: A, spendInr: 10, enquiryCount: 0, costPerEnquiryInr: null, authority: "derived" },
      ],
      residual: {
        unattributedSpendInr: 0,
        unattributedEnquiryCount: 0,
        spendWithoutEnquiriesInr: 10,
        enquiriesWithoutSpendCount: 0,
      },
      lateEnquiryCount: 0,
      totals: { spendInr: 10, enquiryCount: 0 },
      freshness: {
        computedAt: "2026-08-12T07:59:00.000Z",
        sourceWatermark: "2026-08-12T07:58:00.000Z",
        cdcLagSeconds: 60,
        isStale: false,
      },
      authority: "derived",
    });

    const { getCorridorCosts } = await import("./dashboard");
    const summary = await getCorridorCosts(SCOPE, 7, NOW);
    expect(summary!.rows[0].corridorName).toBe("Unnamed corridor");
    expect(summary!.rows[0].costPerEnquiryInr).toBeNull();
  });

  it("returns null when the window has not been computed", async () => {
    readAttribution.mockResolvedValue(null);
    const { getCorridorCosts } = await import("./dashboard");
    expect(await getCorridorCosts(SCOPE, 7, NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ads-agent && npx vitest run lib/db/dashboard.test.ts`
Expected: FAIL — `getCorridorCosts is not a function`.

- [ ] **Step 3: Add `getCorridorCosts` to `dashboard.ts`**

Append to `ads-agent/lib/db/dashboard.ts`:

```ts
import { readAttribution } from "./attribution";
import { listCorridors } from "./corridors";
import { trailingWindow, type AttributionWindow } from "../attribution/window";
import type { Authority } from "../attribution/quarantine";
import type { AttributionResidual } from "../attribution/reconcile";

export type CorridorCostRow = {
  corridorId: string;
  corridorName: string;
  spendInr: number;
  enquiryCount: number;
  costPerEnquiryInr: number | null;
  authority: Authority;
};

export type CorridorCostSummary = {
  window: AttributionWindow;
  rows: CorridorCostRow[];
  residual: AttributionResidual;
  lateEnquiryCount: number;
  totals: { spendInr: number; enquiryCount: number };
  isStale: boolean;
  cdcLagSeconds: number;
  authority: Authority;
};

/** Reads the projected rollup from the `derived` quarantine — one indexed Postgres query,
 *  not a live ClickHouse aggregate on every page render. Returns null when the window has
 *  never been computed; zeroes would be indistinguishable from a genuinely quiet week. */
export async function getCorridorCosts(
  scope: Scope,
  days: number,
  now: Date,
): Promise<CorridorCostSummary | null> {
  const window = trailingWindow(days, now);
  const [stored, corridors] = await Promise.all([
    readAttribution(scope, window),
    listCorridors(scope),
  ]);
  if (!stored) return null;

  const nameById = new Map(corridors.map((c) => [c.id, c.displayName]));

  return {
    window: stored.window,
    rows: stored.corridors.map((c) => ({
      corridorId: c.corridorId,
      // No fabricated name: a corridor id with no vocabulary row is labelled as such.
      corridorName: nameById.get(c.corridorId) ?? "Unnamed corridor",
      spendInr: c.spendInr,
      enquiryCount: c.enquiryCount,
      costPerEnquiryInr: c.costPerEnquiryInr,
      authority: c.authority,
    })),
    residual: stored.residual,
    lateEnquiryCount: stored.lateEnquiryCount,
    totals: stored.totals,
    isStale: stored.freshness.isStale,
    cdcLagSeconds: stored.freshness.cdcLagSeconds,
    authority: stored.authority,
  };
}
```

- [ ] **Step 4: Extend `OverviewStats` and repoint the corridor read**

In `ads-agent/lib/db/dashboard.ts`, change the `OverviewStats` type and `getOverviewStats` so the two provenances are distinguishable:

```ts
export type OverviewStats = {
  activeCampaignCount: number;
  pendingProposalCount: number;
  monthSpendInr: number;
  /** Platform-reported conversions from performance_snapshots. Not our enquiry count. */
  blendedCplInr: number | null;
  /** Our own enquiries, from the attribution rollup. Null when the window is uncomputed. */
  costPerEnquiryInr: number | null;
  attributionIsStale: boolean;
};
```

and at the end of `getOverviewStats`, before the `return`:

```ts
  const attribution = await getCorridorCosts(scope, 30, new Date());
```

then return:

```ts
  return {
    activeCampaignCount: Number(activeResult.rows[0].count),
    pendingProposalCount: Number(pendingResult.rows[0].count),
    monthSpendInr,
    blendedCplInr: monthConversions > 0 ? monthSpendInr / monthConversions : null,
    costPerEnquiryInr:
      attribution && attribution.totals.enquiryCount > 0
        ? attribution.totals.spendInr / attribution.totals.enquiryCount
        : null,
    attributionIsStale: attribution?.isStale ?? false,
  };
```

In `listCampaignsWithLatestCpl`, replace `c.corridor` in the `SELECT` list with the vocabulary join, keeping the output field name so no consumer changes:

```ts
    `SELECT c.id, c.name, c.platform, c.status, c.daily_budget,
            cor.display_name AS corridor, latest.cpl AS latest_cpl
     FROM campaigns c
     LEFT JOIN public.corridors cor ON cor.id = c.corridor_id
     LEFT JOIN LATERAL (
       SELECT cpl FROM performance_snapshots
       WHERE campaign_id = c.id
       ORDER BY captured_at DESC
       LIMIT 1
     ) latest ON true
     ORDER BY c.created_at DESC`,
```

- [ ] **Step 5: Render the numbers and the residual on the home page**

In `ads-agent/app/(admin)/page.tsx`, add the import and the scope, extend the fetch, and render. Replace lines 1–7 with:

```tsx
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole } from "@/lib/auth/dal";
import { getCorridorCosts, getOverviewStats } from "@/lib/db/dashboard";
import { countAiActionsToday, listRecentAiActions } from "@/lib/db/ai-action-log";
import { fetchLeadSignal } from "@/lib/connectors/twenty";
import { getPipelineValue } from "@/lib/crm/twenty-pipeline";
import { orgScopeFromSession } from "@/lib/attribution/org-scope";
import { StatCardView } from "@/lib/openui/shared-metric-cards";
```

Replace the `Promise.all` block (lines 17–23) with:

```tsx
  const scope = orgScopeFromSession(access.session);
  const [overview, attribution, leadSignal, pipelineValueInr, aiActionsToday, recentActions] =
    await Promise.all([
      getOverviewStats(scope),
      getCorridorCosts(scope, 7, new Date()),
      fetchLeadSignal(),
      getPipelineValue(),
      countAiActionsToday(),
      listRecentAiActions(5),
    ]);
```

Replace the stat-card grid (lines 37–42) with:

```tsx
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCardView label="Active Campaigns" value={String(overview.activeCampaignCount)} />
        <StatCardView
          label={overview.attributionIsStale ? "Cost / Enquiry (stale)" : "Cost / Enquiry"}
          value={overview.costPerEnquiryInr === null ? "—" : formatInr(overview.costPerEnquiryInr)}
        />
        <StatCardView label="Hot Leads (7d)" value={String(leadSignal.hotCount)} />
        <StatCardView label="Pipeline Value" value={formatInr(pipelineValueInr)} />
        <StatCardView label="AI Actions Today" value={String(aiActionsToday)} />
      </div>

      {attribution &&
      (attribution.residual.unattributedSpendInr > 0 ||
        attribution.residual.unattributedEnquiryCount > 0) ? (
        <p className="rounded-lg bg-surface p-3 text-xs text-muted-foreground">
          {formatInr(attribution.residual.unattributedSpendInr)} of spend and{" "}
          {attribution.residual.unattributedEnquiryCount} enquiries in the last 7 days belong to no
          corridor, so they are reported here rather than divided across corridors.
          {attribution.isStale
            ? ` These figures are ${attribution.cdcLagSeconds}s behind the source.`
            : ""}
        </p>
      ) : null}
```

The residual line renders only when there is a residual, and it says why the figure exists. Hiding it would leave the corridor table looking complete when it is not — which is the failure this whole step exists to prevent.

- [ ] **Step 6: Run the dashboard tests and the full suite**

Run: `cd ads-agent && npx vitest run lib/db/dashboard.test.ts && npx vitest run`
Expected: PASS, and no regression in `components/SpendCplChart.tsx` or `app/(admin)/campaigns/page.tsx` — both consume unchanged signatures.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/db/dashboard.ts ads-agent/lib/db/dashboard.test.ts "ads-agent/app/(admin)/page.tsx"
git commit -m "feat(dashboard): show cost per enquiry and the unattributed residual

blendedCplInr (platform-reported conversions) and costPerEnquiryInr (our
own enquiries) are kept as separate fields: collapsing them would make
provenance unrecoverable. The residual renders whenever it is non-zero."
```

## Task 10: OpenUI analytics tools

**Files:**
- Modify: `ads-agent/lib/openui/analytics-tools.ts:1-38`
- Modify: `ads-agent/lib/openui/analytics-tools.test.ts`
- Create: `ads-agent/lib/openui/tool-scope.ts`
- Test: `ads-agent/lib/openui/tool-scope.test.ts`

**Skills:** `api-designer`, `typescript-pro`
**Model:** `composer-2.5-fast` — every diff is written out below.

**Interfaces:**
- Consumes: `readAttribution` from `../db/attribution` (Task 8); `trailingWindow` from `../attribution/window` (Task 2); `allocateEqualSplit` from `../attribution/allocation` (Task 4); `corridorListingIds` from `../db/corridors` (Task 7); `orgScopeFromSession` from `../attribution/org-scope` (Task 3); `getSession` from `../auth/dal`; `type ToolProviderMap` from `./platform-tools`.
- Produces: `function toolScope(): Promise<Scope>`; two new keys on `analyticsToolProvider` (`get_corridor_attribution`, `get_per_space_cost_estimate`) and two new entries in `analyticsToolSpecs`.

**Context:** `analyticsToolProvider` stays a plain object and `analyticsToolSpecs` stays an array, so `lib/openui/platform-tools.ts`, `lib/decision-engine/reports-chat.ts` and `mcp/app-data-mcp-server/index.ts` need no change. `platform-tools.ts` composes the provider by spread; new keys arrive automatically. `reports-chat.ts` passes `analyticsToolSpecs` straight through; the new specs arrive automatically. `app-data-mcp-server/index.ts` registers three tools by name, so the two new tools are **not** exposed to Hermes — an agent reading an attribution figure must do so under the freshness rule through the MCP context server at S9.

Every returned payload carries `authority: "derived"` and, for the allocation, `isEstimate: true`. A generative surface renders whatever it is handed, so the label has to be inside the data, not in a prompt.

- [ ] **Step 1: Write the failing tests**

```ts
// ads-agent/lib/openui/tool-scope.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
vi.mock("../auth/dal", () => ({ getSession }));

beforeEach(() => getSession.mockReset());

describe("toolScope", () => {
  it("returns the session's org scope", async () => {
    getSession.mockResolvedValue({
      userId: "u1",
      email: "a@b.c",
      orgId: "10101010-1010-1010-1010-101010101010",
      role: "viewer",
    });
    const { toolScope } = await import("./tool-scope");
    expect(await toolScope()).toEqual({
      kind: "org",
      orgId: "10101010-1010-1010-1010-101010101010",
    });
  });

  it("throws when there is no session, rather than reading unscoped", async () => {
    getSession.mockResolvedValue(null);
    const { toolScope } = await import("./tool-scope");
    await expect(toolScope()).rejects.toThrow(/no session/);
  });

  it("never takes the tenant from tool arguments", async () => {
    // The model must not be able to name its own tenant (data model §5).
    const { toolScope } = await import("./tool-scope");
    expect(toolScope.length).toBe(0);
  });
});
```

```ts
// ads-agent/lib/openui/analytics-tools.test.ts — append these blocks
const readAttribution = vi.fn();
const corridorListingIds = vi.fn();
const toolScope = vi.fn();
vi.mock("../db/attribution", () => ({ readAttribution }));
vi.mock("../db/corridors", () => ({ corridorListingIds }));
vi.mock("./tool-scope", () => ({ toolScope }));

const ORG = "10101010-1010-1010-1010-101010101010";
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const STORED = {
  window: { startDate: "2026-08-06", endDate: "2026-08-12" },
  windowState: "open" as const,
  corridors: [
    { corridorId: A, spendInr: 1000, enquiryCount: 4, costPerEnquiryInr: 250, authority: "derived" as const },
  ],
  residual: {
    unattributedSpendInr: 600,
    unattributedEnquiryCount: 2,
    spendWithoutEnquiriesInr: 0,
    enquiriesWithoutSpendCount: 0,
  },
  lateEnquiryCount: 0,
  totals: { spendInr: 1600, enquiryCount: 6 },
  freshness: {
    computedAt: "2026-08-12T08:00:00.000Z",
    sourceWatermark: "2026-08-12T07:59:00.000Z",
    cdcLagSeconds: 60,
    isStale: false,
  },
  authority: "derived" as const,
};

describe("analyticsToolSpecs declares the attribution tools", () => {
  it("includes both new tools", () => {
    const names = analyticsToolSpecs.map((s) => s.name);
    expect(names).toContain("get_corridor_attribution");
    expect(names).toContain("get_per_space_cost_estimate");
  });

  it("says in the description that per-space cost is an estimate", () => {
    const spec = analyticsToolSpecs.find((s) => s.name === "get_per_space_cost_estimate")!;
    expect(spec.description.toLowerCase()).toContain("estimate");
  });
});

describe("analyticsToolProvider.get_corridor_attribution", () => {
  beforeEach(() => {
    readAttribution.mockReset().mockResolvedValue(STORED);
    toolScope.mockReset().mockResolvedValue({ kind: "org", orgId: ORG });
  });

  it("returns the residual alongside the corridors, tagged derived", async () => {
    const out = (await analyticsToolProvider.get_corridor_attribution({ days: 7 })) as Record<
      string,
      unknown
    >;
    expect(out.authority).toBe("derived");
    expect(out.residual).toEqual(STORED.residual);
    expect(out.corridors).toHaveLength(1);
  });

  it("defaults to a 7-day window", async () => {
    await analyticsToolProvider.get_corridor_attribution({});
    expect(readAttribution.mock.calls[0][1]).toHaveProperty("startDate");
  });

  it("returns an explicit not-computed marker rather than empty numbers", async () => {
    readAttribution.mockResolvedValue(null);
    const out = (await analyticsToolProvider.get_corridor_attribution({})) as Record<string, unknown>;
    expect(out).toEqual({ computed: false, reason: "no attribution has been computed for this window" });
  });
});

describe("analyticsToolProvider.get_per_space_cost_estimate", () => {
  beforeEach(() => {
    readAttribution.mockReset().mockResolvedValue(STORED);
    corridorListingIds.mockReset().mockResolvedValue(["l1", "l2"]);
    toolScope.mockReset().mockResolvedValue({ kind: "org", orgId: ORG });
  });

  it("labels every row as an equal-split estimate", async () => {
    const out = (await analyticsToolProvider.get_per_space_cost_estimate({
      corridorId: A,
      days: 7,
    })) as { estimates: { isEstimate: boolean; basis: string; estimatedSpendShareInr: number }[] };

    expect(out.estimates).toHaveLength(2);
    for (const row of out.estimates) {
      expect(row.isEstimate).toBe(true);
      expect(row.basis).toBe("equal_split");
      expect(row.estimatedSpendShareInr).toBe(500);
    }
  });

  it("requires a corridorId rather than guessing one", async () => {
    await expect(analyticsToolProvider.get_per_space_cost_estimate({})).rejects.toThrow(/corridorId/);
  });

  it("returns no estimates for a corridor absent from the window", async () => {
    const out = (await analyticsToolProvider.get_per_space_cost_estimate({
      corridorId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    })) as { estimates: unknown[]; reason: string };
    expect(out.estimates).toEqual([]);
    expect(out.reason).toMatch(/no spend or enquiries/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ads-agent && npx vitest run lib/openui/tool-scope.test.ts lib/openui/analytics-tools.test.ts`
Expected: FAIL — unresolved `./tool-scope`, and the two provider keys are `undefined`.

- [ ] **Step 3: Write `tool-scope.ts`**

```ts
// ads-agent/lib/openui/tool-scope.ts
import { orgScopeFromSession } from "../attribution/org-scope";
import { getSession } from "../auth/dal";
import type { Scope } from "../db/scope-sql";

/** Takes no arguments on purpose: the model must never be able to name its own tenant
 *  (data model §5). Always org scope — a generative surface does not read across orgs. */
export async function toolScope(): Promise<Scope> {
  const session = await getSession();
  if (!session) throw new Error("no session: analytics tools cannot run unauthenticated");
  return orgScopeFromSession(session);
}
```

- [ ] **Step 4: Add the two tools to `analytics-tools.ts`**

Replace the whole file with:

```ts
import type { ToolSpec } from "@openuidev/lang-core";
import { allocateEqualSplit } from "../attribution/allocation";
import { trailingWindow } from "../attribution/window";
import { readAttribution } from "../db/attribution";
import { corridorListingIds } from "../db/corridors";
import { getSpendCplTrend, listCampaignsWithLatestCpl } from "../db/dashboard";
import { listProposals } from "../db/proposals";
import type { ToolProviderMap } from "./platform-tools";
import { toolScope } from "./tool-scope";

function daysArg(args: Record<string, unknown>): number {
  return typeof args.days === "number" ? args.days : 7;
}

export const analyticsToolProvider: ToolProviderMap = {
  get_spend_cpl_trend: async (args: Record<string, unknown>) => {
    const days = daysArg(args);
    return getSpendCplTrend(days);
  },
  list_campaigns_with_cpl: async () => listCampaignsWithLatestCpl(),
  list_pending_proposals: async () => listProposals("pending"),

  get_corridor_attribution: async (args: Record<string, unknown>) => {
    const scope = await toolScope();
    const stored = await readAttribution(scope, trailingWindow(daysArg(args), new Date()));
    // An explicit marker, not empty numbers: zeroes would read as a quiet week.
    if (!stored) {
      return { computed: false, reason: "no attribution has been computed for this window" };
    }
    return {
      window: stored.window,
      windowState: stored.windowState,
      corridors: stored.corridors,
      residual: stored.residual,
      lateEnquiryCount: stored.lateEnquiryCount,
      totals: stored.totals,
      freshness: stored.freshness,
      authority: stored.authority,
    };
  },

  get_per_space_cost_estimate: async (args: Record<string, unknown>) => {
    const corridorId = typeof args.corridorId === "string" ? args.corridorId : null;
    if (!corridorId) throw new Error("get_per_space_cost_estimate requires a corridorId");

    const scope = await toolScope();
    const window = trailingWindow(daysArg(args), new Date());
    const stored = await readAttribution(scope, window);
    const corridor = stored?.corridors.find((c) => c.corridorId === corridorId);
    if (!corridor) {
      return {
        window,
        estimates: [],
        reason: "that corridor had no spend or enquiries in this window",
      };
    }

    const listingIds = await corridorListingIds(scope, corridorId);
    return {
      window,
      basis: "equal_split",
      authority: stored!.authority,
      // BD4: spend is corridor-level, so this is an allocation. Every row says so.
      estimates: allocateEqualSplit({
        corridorId,
        spendInr: corridor.spendInr,
        enquiryCount: corridor.enquiryCount,
        listingIds,
      }),
    };
  },
};

export const analyticsToolSpecs: ToolSpec[] = [
  {
    name: "get_spend_cpl_trend",
    description: "Get the daily spend/CPL trend for the last N days (default 7).",
    inputSchema: {
      type: "object",
      properties: { days: { type: "number", description: "Number of days back, default 7" } },
      required: [],
    },
    outputSchema: { type: "object" },
  },
  {
    name: "list_campaigns_with_cpl",
    description: "List every campaign with its platform, status, daily budget, corridor, and latest CPL.",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "array" },
  },
  {
    name: "list_pending_proposals",
    description: "List every proposal currently awaiting human approval.",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "array" },
  },
  {
    name: "get_corridor_attribution",
    description:
      "Measured spend, enquiry count and cost per enquiry per corridor for the last N days " +
      "(default 7), plus the residual: spend and enquiries that belong to no corridor. The " +
      "residual is never divided across corridors. Figures are derived and carry their CDC lag.",
    inputSchema: {
      type: "object",
      properties: { days: { type: "number", description: "Number of days back, default 7" } },
      required: [],
    },
    outputSchema: { type: "object" },
  },
  {
    name: "get_per_space_cost_estimate",
    description:
      "Per-space cost for one corridor as an equal-split estimate, not a measurement: campaigns " +
      "are corridor-level so per-space spend cannot be measured. Every row is labelled an estimate.",
    inputSchema: {
      type: "object",
      properties: {
        corridorId: { type: "string", description: "The corridor to allocate across its listings" },
        days: { type: "number", description: "Number of days back, default 7" },
      },
      required: ["corridorId"],
    },
    outputSchema: { type: "object" },
  },
];
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd ads-agent && npx vitest run lib/openui/tool-scope.test.ts lib/openui/analytics-tools.test.ts`
Expected: PASS — 12 tests, including the pre-existing three-tool tests, whose assertion of exactly three names must be updated to the five now declared. Do that in the same commit: change

```ts
    expect(analyticsToolSpecs.map((s) => s.name).sort()).toEqual(
      ["get_spend_cpl_trend", "list_campaigns_with_cpl", "list_pending_proposals"].sort(),
    );
```

to

```ts
    expect(analyticsToolSpecs.map((s) => s.name).sort()).toEqual(
      [
        "get_corridor_attribution",
        "get_per_space_cost_estimate",
        "get_spend_cpl_trend",
        "list_campaigns_with_cpl",
        "list_pending_proposals",
      ].sort(),
    );
```

and rename that test's title from "declares the three analytics tools by name" to "declares every analytics tool by name".

- [ ] **Step 6: Confirm the untouched consumers still pass**

Run: `cd ads-agent && npx vitest run mcp/app-data-mcp-server/index.test.ts lib/openui/platform-tools.test.ts`
Expected: PASS. The MCP server registers three tools by name and is unaffected; `platform-tools.ts` spreads the provider and picks the new keys up without change.

- [ ] **Step 7: Commit**

```bash
git add ads-agent/lib/openui/analytics-tools.ts ads-agent/lib/openui/analytics-tools.test.ts \
        ads-agent/lib/openui/tool-scope.ts ads-agent/lib/openui/tool-scope.test.ts
git commit -m "feat(openui): expose corridor attribution and the labelled per-space estimate

The residual travels with the corridors, and the estimate carries
isEstimate/basis inside the payload -- a generative surface renders what
it is handed, so the label cannot live in a prompt. toolScope takes no
arguments so the model cannot name its own tenant."
```

---

# Wave 5

## Task 11 (fan-in): The S7 gate

**Files:**
- Test: `ads-agent/lib/attribution/gate.test.ts` (new)

**Skills:** `senior-qa`, `adversarial-reviewer`, `code-reviewer`
**Model:** `inherit` — the gate is a judgement about whether the numbers are honest, not a transcription.

**Interfaces:**
- Consumes: everything from Tasks 1–10.
- Produces: nothing. This task's output is a passing gate and a merged branch.

- [ ] **Step 1: Merge the Wave 4 branches into the integration branch**

```bash
git checkout <integration-branch>
git merge --no-ff <task-9-branch> <task-10-branch>
```

Expected: no conflicts. Task 9 and Task 10 touch disjoint files; the only shared dependency is `lib/db/attribution.ts`, which neither modifies.

- [ ] **Step 2: Write the end-to-end honesty test**

```ts
// ads-agent/lib/attribution/gate.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const writeAttribution = vi.fn();
const readAttribution = vi.fn();
vi.mock("../db/attribution", () => ({ writeAttribution, readAttribution }));

import { assertConserved, AttributionConservationError } from "./reconcile";
import { corridorEnquirySql, corridorSpendSql, sourceWatermarkSql } from "./analytical-source";
import { rebuildAttribution } from "./rebuild";
import { allocateEqualSplit } from "./allocation";
import { assertNotSoleDerivedJustification, DerivedOnlyJustificationError } from "./quarantine";

const SCOPE = { kind: "org" as const, orgId: "12121212-1212-1212-1212-121212121212" };
const WINDOW = { startDate: "2026-08-01", endDate: "2026-08-07" };
const HSR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORR = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const NOW = new Date("2026-08-08T10:00:00Z");

/** A realistic incomplete join: three campaigns' spend, one of which has no corridor,
 *  and enquiries in only two corridors, one of which received no spend. */
function mirror() {
  return vi.fn(async (sql: string) => {
    if (sql === corridorSpendSql()) {
      return [
        { corridor_id: HSR, spend_inr: "12000" },
        { corridor_id: ORR, spend_inr: "8000" },
        { corridor_id: null, spend_inr: "4500" },
      ];
    }
    if (sql === corridorEnquirySql()) {
      return [
        { corridor_id: HSR, enquiry_count: "24" },
        { corridor_id: null, enquiry_count: "9" },
      ];
    }
    if (sql === sourceWatermarkSql()) return [{ watermark: "2026-08-08 09:58:00.000" }];
    throw new Error(`unexpected sql: ${sql}`);
  });
}

beforeEach(() => {
  writeAttribution.mockReset().mockResolvedValue(undefined);
  readAttribution.mockReset().mockResolvedValue(null);
});

describe("S7 gate: per-corridor cost is real, not invented", () => {
  it("each corridor's cost follows only from its own spend and its own enquiries", async () => {
    const r = await rebuildAttribution(SCOPE, { query: mirror() as never, window: WINDOW, now: NOW });

    const hsr = r.corridors.find((c) => c.corridorId === HSR)!;
    expect(hsr.spendInr).toBe(12000);
    expect(hsr.enquiryCount).toBe(24);
    expect(hsr.costPerEnquiryInr).toBe(500);

    const orr = r.corridors.find((c) => c.corridorId === ORR)!;
    expect(orr.spendInr).toBe(8000);
    expect(orr.enquiryCount).toBe(0);
    // 8000 spend and no enquiries is not "8000 per enquiry" and not "0". It is unknown.
    expect(orr.costPerEnquiryInr).toBeNull();
  });

  it("unattributed spend and unattributed enquiries are their own reported figures", async () => {
    const r = await rebuildAttribution(SCOPE, { query: mirror() as never, window: WINDOW, now: NOW });
    expect(r.residual.unattributedSpendInr).toBe(4500);
    expect(r.residual.unattributedEnquiryCount).toBe(9);
    expect(r.residual.spendWithoutEnquiriesInr).toBe(8000);
    expect(r.residual.enquiriesWithoutSpendCount).toBe(0);
    expect(r.totals).toEqual({ spendInr: 24500, enquiryCount: 33 });
  });

  it("every fabrication of the residual is rejected", async () => {
    const r = await rebuildAttribution(SCOPE, { query: mirror() as never, window: WINDOW, now: NOW });

    // 1. Spread the unattributed spend evenly. The most plausible-looking lie.
    const spread = {
      ...r,
      corridors: r.corridors.map((c) => {
        const spendInr = c.spendInr + r.residual.unattributedSpendInr / r.corridors.length;
        return {
          ...c,
          spendInr,
          costPerEnquiryInr: c.enquiryCount > 0 ? spendInr / c.enquiryCount : null,
        };
      }),
    };
    expect(() => assertConserved(spread)).toThrow(AttributionConservationError);

    // 2. Attribute the orphan enquiries to the biggest corridor.
    const absorbed = {
      ...r,
      corridors: r.corridors.map((c, i) =>
        i === 0
          ? {
              ...c,
              enquiryCount: c.enquiryCount + r.residual.unattributedEnquiryCount,
              costPerEnquiryInr: c.spendInr / (c.enquiryCount + r.residual.unattributedEnquiryCount),
            }
          : c,
      ),
    };
    expect(() => assertConserved(absorbed)).toThrow(AttributionConservationError);

    // 3. Give the no-enquiry corridor a cost per enquiry anyway.
    const invented = {
      ...r,
      corridors: r.corridors.map((c) =>
        c.enquiryCount === 0 ? { ...c, costPerEnquiryInr: c.spendInr } : c,
      ),
    };
    expect(() => assertConserved(invented)).toThrow(/cost per enquiry/);

    // 4. Drop the residual so the corridor table looks complete.
    const hidden = {
      ...r,
      residual: { ...r.residual, unattributedSpendInr: 0, unattributedEnquiryCount: 0 },
    };
    expect(() => assertConserved(hidden)).toThrow(AttributionConservationError);
  });

  it("writes only a conserved result, and carries its lag with it", async () => {
    await rebuildAttribution(SCOPE, { query: mirror() as never, window: WINDOW, now: NOW });
    const [, written, f] = writeAttribution.mock.calls[0];
    expect(() => assertConserved(written)).not.toThrow();
    expect(f.cdcLagSeconds).toBe(120);
    expect(f.isStale).toBe(false);
  });

  it("the per-space figure is an allocation that conserves the corridor total", async () => {
    const r = await rebuildAttribution(SCOPE, { query: mirror() as never, window: WINDOW, now: NOW });
    const hsr = r.corridors.find((c) => c.corridorId === HSR)!;
    const rows = allocateEqualSplit({
      corridorId: HSR,
      spendInr: hsr.spendInr,
      enquiryCount: hsr.enquiryCount,
      listingIds: ["l1", "l2", "l3", "l4"],
    });

    expect(rows.every((x) => x.isEstimate)).toBe(true);
    expect(rows.reduce((t, x) => t + x.estimatedSpendShareInr, 0)).toBeCloseTo(hsr.spendInr, 9);
  });

  it("a derived attribution figure cannot justify a proposal on its own", () => {
    expect(() =>
      assertNotSoleDerivedJustification([
        { authority: "derived", ref: "derived.corridor_attribution_daily:hsr" },
      ]),
    ).toThrow(DerivedOnlyJustificationError);

    expect(() =>
      assertNotSoleDerivedJustification([
        { authority: "derived", ref: "derived.corridor_attribution_daily:hsr" },
        { authority: "record", ref: "adsagent.campaigns:1" },
      ]),
    ).not.toThrow();
  });
});
```

- [ ] **Step 3: Run the gate and watch it pass**

Run: `cd ads-agent && npx vitest run lib/attribution/gate.test.ts`
Expected: PASS — 6 tests. If any of the four fabrications in test 3 does **not** throw, S7 has not passed: stop and fix `assertConserved` rather than weakening the test.

- [ ] **Step 4: Verify the database refuses the same fabrications**

```bash
cd ads-agent
psql "$DATABASE_URL" -c "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'derived' AND c.relkind = 'r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)"
```

Expected: zero rows. Any table listed is unprotected.

```bash
psql "$DATABASE_URL" -c "SELECT conname FROM pg_constraint WHERE conname IN ('corridor_attribution_cost_is_real','attribution_reconciliation_residual_fits')"
```

Expected: both names present.

- [ ] **Step 5: Reconcile the projection against the mirror**

```bash
psql "$DATABASE_URL" -c "
SELECT r.window_start, r.window_end,
       r.total_spend_inr,
       (SELECT COALESCE(SUM(d.spend_inr), 0)
          FROM derived.corridor_attribution_daily d
         WHERE d.org_id = r.org_id
           AND d.window_start = r.window_start
           AND d.window_end   = r.window_end) AS summed_rows
  FROM derived.attribution_reconciliation r
 ORDER BY r.window_start DESC LIMIT 10"
```

Expected: `total_spend_inr` equals `summed_rows` on every row, because the NULL-corridor row carries the unattributed spend. Any disagreement means a corridor row was written without its residual row — fail the gate.

- [ ] **Step 6: Full suite, both apps**

Run: `cd ads-agent && npx vitest run`
Then: `cd .. && npx vitest run`
Expected: all green in both.

- [ ] **Step 7: Commit and dispatch the final review**

```bash
git add ads-agent/lib/attribution/gate.test.ts
git commit -m "test(attribution): the S7 gate -- per-corridor cost is real, not invented

Four fabrications are enumerated and each is rejected: spreading the
unattributed spend, absorbing orphan enquiries into the biggest corridor,
inventing a cost for a corridor with no enquiries, and dropping the
residual so the table looks complete."
```

Dispatch one `adversarial-reviewer` on `inherit` over `git diff $(git merge-base main HEAD)..HEAD`, with the Global Constraints as its attention lens and these three questions named explicitly:

1. Can any query in `lib/attribution/*` or `lib/db/{corridors,attribution}.ts` reach a tenant table without `scopeClause` or `set_tenant`?
2. Is there any path by which a number reaches `derived.corridor_attribution_daily` without passing `assertConserved`?
3. Does any surface render a per-space figure without `isEstimate`, or an attribution figure without its freshness?

**S7 gate:** `gate.test.ts` green with all four fabrications rejected; zero rows from the `FORCE ROW LEVEL SECURITY` check on the `derived` schema; both `CHECK` constraints present; the projection reconciles against its own residual row; both suites green.

---

## Self-review

**1. Spec coverage.**

| Requirement | Task |
|---|---|
| Build sequence S7 row, "per-corridor cost is real, not invented" | Task 11 gate, backed by Task 5's `assertConserved` |
| Backend spec D1 — corridor as a real entity | Task 1 (070, 072) |
| Backend spec D2 — listings readable from `ads-agent` | Task 1 (071 joins `listings.listings`), Task 7 (`corridorListingIds`) — the consolidation `GRANT` is S3's |
| Backend spec D3 — enquiry → listing resolution | Task 7 (`listingSlugFromUrl`, `resolveEnquiryListings`), Task 1 (073) |
| Backend spec D4 — corridor spend rollup, windowed | Task 6 (`corridorSpendSql`), Task 5 (`reconcile`), Task 2 (window) |
| Backend spec D5 — per-space allocation, labelled an estimate | Task 4, surfaced by Task 10 |
| Backend spec D6 — cost per enquiry with a defined window | Tasks 2, 5, 8, 9 |
| Backend spec §1 structural finding (`ads-agent` cannot see listings; enquiries unstored) | Preconditions S3 and S5; Task 7 is the first `ads-agent` code to read `listings.*` |
| Backend spec §2 BD4 (allocation not measurement), BD7 (dead corridor column) | Task 4, Task 1 (072) |
| Backend spec §4 sequencing (Phase 3 after consolidation) | Preconditions section |
| Backend spec §6 ("My spaces" ₹840 each; label it or show corridor cost plus counts) | Task 9 renders corridor cost plus counts plus residual; Task 10 provides the labelled estimate |
| Backend spec §5 Q3 (corridor vocabulary), Q5 (allocation rule) | Decisions section, implemented in Tasks 1 and 4 |
| Data model §4 attribution (`corridors`, `listing_corridors`, `campaigns.corridor_id`) | Task 1 (070–072), verbatim |
| Data model §0 conventions and `derived` quarantine | Global Constraints; Task 1 (074); Task 3 (`quarantine.ts`) |
| Data model §1 tenancy primitives | Task 1 (074 RLS), Task 8 (`set_tenant` in transaction) |
| Data model §7 (what belongs in ClickHouse) | Task 6, including `spend_fact` which §7 omits |
| Datastore §12.1 freshness and refusing to act on stale data | Task 3 (`freshness.ts`), Task 8 (lag on every row), Task 9 (stale label) |
| Build sequence "reads the replica, not the primary" | Task 6's store-routing table |

**Gaps I am declaring rather than hiding:**

- **`assertFreshEnoughToSpend` has no call site in S7.** It is built and unit-tested here because the freshness data originates here, but the hard rule it enforces — refusing to propose a spend change on stale data — belongs to a proposal path. That path is S11 (backend spec E2 pre-flight checks) and S10 (the first agent). Wiring it would mean editing `lib/decision-engine/cycle.ts`, which this plan deliberately does not open.
- **`assertNotSoleDerivedJustification` likewise has no production call site in S7.** Same reason: `proposals.evidence` is written by the decision engine. S7 provides and tests the guard; S11 wires it.
- **The CDC watermark table is populated by S6, not here.** Task 6 creates `cdc_watermark` because attribution is its first reader, but nothing in S7 writes to it. If S6's relay does not maintain it, `fetchSourceWatermark` throws — which is the correct failure, not a silent zero.
- **Corridor vocabulary maintenance has no UI.** Adding a corridor is a migration in the 075–079 range. For a solo operator with 17 corridors this is the right amount of machinery; a CRUD screen belongs with the CMS at S17.

**2. Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N", no "write tests for the above". Every code step carries complete code. Every command carries its expected output. Two conditional instructions exist and both are escalation branches with a stated stop, not deferred work: Task 6 Step 6 ("if `enquiry_fact` does not exist, stop and escalate") and Task 11 Step 3 ("if any fabrication does not throw, stop and fix"). The one number left blank on purpose is `<N>` in Task 1's commit message — the count of unmapped listings, which is measured in Step 9 and cannot be known in advance.

**3. Type consistency.** Checked across tasks:

- `AttributionWindow` / `WindowState` — defined in Task 2, imported unchanged by Tasks 5, 6, 8, 9, 10.
- `CorridorSpendRow` / `CorridorEnquiryRow` — defined in Task 5, produced by Task 6, consumed by Task 8.
- `AttributionResult`, `AttributionResidual`, `CorridorAttribution` — defined in Task 5; `AttributionResult` is what Task 8 writes and Task 5's `applyFrozenWindow` returns.
- `StoredAttribution` extends the same shape with `freshness` and `authority`; Task 8 strips `authority` off each corridor before calling `applyFrozenWindow`, which expects plain `CorridorAttribution`. Verified in Task 8's `rebuild.ts`.
- `AttributionFreshness` — Task 3; the field names `computedAt`, `sourceWatermark`, `cdcLagSeconds`, `isStale` are used identically in Tasks 8, 9, 10 and in migration 074's columns `computed_at`, `source_watermark`, `cdc_lag_seconds`.
- `Authority` — Task 3; `"derived"` is the only value S7 writes, and it appears on `StoredCorridorAttribution`, `StoredAttribution`, `CorridorCostRow` and both tool payloads.
- `PerSpaceCostEstimate.isEstimate` is the literal `true` in Task 4 and asserted as such in Tasks 10 and 11.
- `Scope` is imported from `../db/scope-sql` in every module that takes it, and is the first parameter of `listCorridors`, `corridorListingIds`, `resolveEnquiryListings`, `countUnresolvedEnquiries`, `writeAttribution`, `readAttribution`, `rebuildAttribution`, `getCorridorCosts`, `fetchCorridorSpend`, `fetchCorridorEnquiries`, `fetchSourceWatermark`.
- `getCorridorCosts` is the single name used in both `dashboard.ts` and `app/(admin)/page.tsx`; `readAttribution` / `writeAttribution` are the only names used for the `derived` accessors — no `getAttribution` / `saveAttribution` variants anywhere.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-12-s7-attribution.md`. Two execution options:

**1. Subagent-Driven (recommended)** — one fresh subagent per task in its own git worktree and branch, review between tasks, fan-in merge closing each wave.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batching by wave with a checkpoint at each gate.

Which approach?
