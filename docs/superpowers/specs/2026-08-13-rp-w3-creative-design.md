# RP-W3 — Creative engine: copy, listing statics, A/B, fatigue

Date: 2026-08-13  
Status: approved  
Program: [`2026-08-13-rp-program-design.md`](2026-08-13-rp-program-design.md)  
Depends on: W0 (`lib/channels/`, `lib/autonomy/`, `lib/tenant-config/`), W2 (`writeAdAssets`)  
Migration range: **150–159**  
Owned paths: `ads-agent/lib/creative/`, `ads-agent/app/(admin)/creative/`

## Problem

Creative generation was an explicit non-goal of the 2026-08-03 design: the operator supplies creative by hand. Ryze writes ad variants, A/B tests them automatically and refreshes them on fatigue. Unlike Ryze, we hold the raw material — real listings with photos, localities, sizes, amenities and pricing bands — so generated creative can be specific and truthful rather than generic.

## Goals

1. Generate policy-valid ad copy variants (Google RSA and Meta/LinkedIn primary text) grounded in listing and tenant-config facts.
2. Compose static image creative from real listing photographs with brand-kit overlays.
3. Run structured A/B tests across variants with an explicit stopping rule.
4. Detect creative fatigue and propose refreshes through the standard autonomy path.

## Non-goals

- AI-generated or stock imagery of properties, and any generative video/UGC. Property imagery must be a real photograph of the listing being advertised.
- Landing pages (W7 owns pages; this workstream sets `finalUrl` only).
- Publishing assets to platforms directly — it calls W2's `writeAdAssets` through a proposal.

## Grounding and truthfulness

Copy generation reuses the evidence-bound pattern already proven in `lib/spaces/insight-prompt.ts` and `lib/generative/citation-gate.ts`: the model receives a fact packet with stable IDs and returns selections plus phrasing, and the server renders the final text from the actual facts. A variant that asserts a fact not present in the packet fails the citation gate and is discarded before it can reach a proposal. Redaction runs first — `lib/listings/redact.ts` — so sensitive lines never enter a creative.

## Architecture

```text
listing + tenant_config ──► fact packet (stable IDs)
        │
        ├─► copy generator ──► policy validator (length/count/casing per channel) ──► citation gate
        │
        └─► image composer ──► listing photo (artifact) + brand overlay ──► artifact store (Garage)
                                        │
                                        ▼
                        creative_variants  ──►  experiment assignment
                                        │
                                        ▼
              proposal (creative.publish_variant) → autonomy → W2 writeAdAssets
                                        │
                                        ▼
                       performance rows → fatigue detector → creative.refresh proposal
```

## Data model (migrations 150–152)

```sql
CREATE TABLE adsagent.creative_variants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  channel       text NOT NULL,
  listing_id    uuid,
  kind          text NOT NULL CHECK (kind IN ('copy','static')),
  payload       jsonb NOT NULL,            -- headlines/descriptions, or artifact keys + overlay spec
  fact_packet_hash text NOT NULL,          -- provenance for the citation gate
  state         text NOT NULL DEFAULT 'draft'
                CHECK (state IN ('draft','live','paused','retired')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE adsagent.creative_experiments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  campaign_id text NOT NULL,
  variant_ids uuid[] NOT NULL,
  metric      text NOT NULL DEFAULT 'cost_per_qualified_lead',
  min_impressions_per_variant integer NOT NULL DEFAULT 1000,
  min_days     integer NOT NULL DEFAULT 7,
  state       text NOT NULL DEFAULT 'running'
              CHECK (state IN ('running','concluded','aborted')),
  winner_variant_id uuid,
  started_at  timestamptz NOT NULL DEFAULT now()
);
```

Both tables carry `org_id`, RLS `FORCE`, and a leading-edge tenant index (GC6). Migration 152 seeds per-channel copy constraints (Google RSA: 3–15 headlines ≤30 chars, 2–4 descriptions ≤90 chars — the values already encoded in `lib/decision-engine/campaign-draft-rules.ts`, which this workstream reuses rather than duplicates).

## A/B stopping rule

An experiment concludes only when every variant has reached `min_impressions_per_variant` **and** `min_days` have elapsed, at which point the winner is the variant with the best cost per qualified lead (the `objective` from tenant config). Ties within a 5% band conclude as "no winner" and retire nothing. This deliberately avoids peeking-based early stopping, which inflates false winners at the sample sizes a CRE budget produces.

## Fatigue detection

A variant is fatigued when, over a trailing 7-day window with at least the minimum impressions, its CTR has declined by more than a configured fraction from its own first-week baseline **and** frequency has risen above the channel threshold. Fatigue emits a `creative.refresh` proposal carrying the replacement variant, so the refresh itself is subject to autonomy and audit like any other write.

## Action kinds registered

| Kind | Default | Notes |
|---|---|---|
| `creative.publish_variant` | gated, `required_streak` 10 | Writes assets to a live ad account |
| `creative.refresh` | gated, `required_streak` 8 | Swaps a fatigued variant for a ready one |
| `creative.pause_variant` | gated, `required_streak` 6 | Reversible, stops spend |

## Interfaces

**Consumes:** `getTenantConfig`, `evaluateAutonomy`, `writeAdAssets` (W2), `putArtifact` (`lib/artifacts/store.ts`), `redactSensitiveText`.

**Produces:**

```ts
export function generateCopyVariants(input: CopyInput): Promise<CreativeVariant[]>;
export function composeStatic(input: StaticInput): Promise<{ artifactKey: string }>;
export function startExperiment(input: ExperimentInput): Promise<{ experimentId: string }>;
export function concludeExperiment(orgId: string, experimentId: string): Promise<ExperimentOutcome>;
export function detectFatigue(orgId: string, window: DateRange): Promise<FatigueSignal[]>;
```

## Admin surface

`app/(admin)/creative/`: a variant library filtered by channel and state, an experiment board showing progress against the stopping rule, and a fatigue queue. Generation is operator-triggered or agent-triggered; publishing always goes through the proposals surface, never a direct button.

## Testing

- `copy-generator.test.ts` — every generated variant satisfies channel constraints; a hallucinated fact is rejected by the citation gate; redaction runs before the fact packet is built.
- `image-composer.test.ts` — overlay placement deterministic for a fixed brand kit; output written to artifacts with a content-addressed key; no property image is synthesised.
- `experiment.test.ts` — the stopping rule refuses to conclude early; ties produce no winner.
- `fatigue.test.ts` — fatigue requires both the CTR decline and the frequency rise; sparse data produces no signal.
- `w3-gate.test.ts` — no code path writes assets to a channel without a proposal that passed `evaluateAutonomy` (assert the adapter stub is unreachable except via the executor).
