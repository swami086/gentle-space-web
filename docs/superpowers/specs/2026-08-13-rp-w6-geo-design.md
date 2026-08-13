# RP-W6 — GEO: AI-search visibility and citations

Date: 2026-08-13  
Status: approved  
Program: [`2026-08-13-rp-program-design.md`](2026-08-13-rp-program-design.md)  
Depends on: W0 (`lib/publish/` contract, `lib/autonomy/`, `lib/tenant-config/`)  
Migration range: **180–189**  
Owned paths: `ads-agent/lib/geo/`, `ads-agent/app/(admin)/geo/`

## Problem

Ryze markets "get cited by ChatGPT, Perplexity, Gemini and Bing", ships an AI search visibility checker and an llms.txt generator, and sells share-of-voice measurement across AI assistants. Buyers increasingly start commercial-property research in an assistant rather than a search box, and we currently have no visibility into whether a tenant's pages are retrievable or citable there, nor any measurement of it.

## Goals

1. Measure whether a tenant's brand and pages are cited by AI assistants for a tracked prompt set, over time.
2. Make hosted pages maximally citable: self-contained passages, unambiguous entities, structured data, and machine-readable access declarations.
3. Verify AI crawler accessibility (robots directives, rendering without JavaScript, response codes) and open issues when a surface is unreachable.
4. Report share of voice against named competitors per prompt cluster.

## Non-goals

- Manipulating assistant outputs, prompt-injection content, or any cloaking of content shown to crawlers versus users. Serving different content to crawlers is cloaking under [Google's spam policies](https://developers.google.com/search/docs/essentials/spam-policies) and is prohibited by GC3.
- Guaranteeing citations. The product measures and improves retrievability; it does not promise placement.
- Paid placement inside assistants (ads-in-ChatGPT is wave 2).

## Honest framing of `llms.txt`

`llms.txt` is a proposed convention, not a standard any major assistant has committed to honouring, and it is not used by Google Search. We generate and serve it because the cost is near zero and some tooling reads it, but the spec explicitly does **not** treat it as a ranking or citation mechanism, and the admin UI must not claim it is. The substantive work is passage structure, entity clarity, structured data and crawler accessibility.

## Architecture

```text
prompt set (per tenant, per cluster)
      │
      ▼
assistant probes (scheduled) ──► citation extractor ──► geo_citations
      │                                                      │
      ▼                                                      ▼
crawler accessibility checks                        share-of-voice rollup
      │                                                      │
      ▼                                                      ▼
citability analyser (passages, entities, schema) ──► geo.* proposals → autonomy
                                                              │
                                                              ▼
                                              lib/publish client → cms-service
```

## Measurement method

Each tenant has a prompt set derived from its tracked queries and localities (for example, "best coworking near Whitefield for a 40-person team"). On a schedule, each prompt is submitted to the configured assistants, and the response is parsed for brand mentions and linked citations. Each observation records the assistant, prompt, whether the brand appeared, whether it was cited with a link, which URL, and which competitors appeared.

Two honesty requirements are built into the design. Assistant responses are non-deterministic, so a single observation is never treated as a trend — the UI reports rates over a rolling window with the observation count visible. And the probe records the raw response artifact, so a claimed citation can always be re-verified rather than trusted from a parsed boolean.

## Citability analyser

Per page it scores: whether key answers appear as self-contained passages that survive extraction out of context; whether entities (locality, building, operator, area, price band) are named unambiguously rather than pronominalised; whether structured data covers the entity types present; whether the page states facts with dates so freshness is legible; and whether the primary content renders without client-side JavaScript. Each failing dimension emits an issue with a fix payload, applied through the same proposal path as W5.

## Crawler accessibility checks

Verifies robots.txt directives for known assistant crawlers, checks that pages return 200 with content to a non-JS fetch, and confirms canonical and hreflang consistency. A tenant intentionally disallowing an assistant is recorded as a deliberate policy, not an issue — the check reports intent mismatches, not a fixed opinion.

## Data model (migrations 180–183)

```sql
CREATE TABLE adsagent.geo_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL, cluster text NOT NULL, prompt text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (org_id, prompt)
);

CREATE TABLE adsagent.geo_observations (
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL, prompt_id uuid NOT NULL, assistant text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  brand_mentioned boolean NOT NULL, cited_url text,
  competitors text[] NOT NULL DEFAULT '{}',
  response_artifact_key text NOT NULL
);

CREATE TABLE adsagent.geo_citability (
  org_id uuid NOT NULL, page_id uuid NOT NULL, checked_at timestamptz NOT NULL DEFAULT now(),
  passage_score integer NOT NULL, entity_score integer NOT NULL,
  schema_score integer NOT NULL, render_ok boolean NOT NULL,
  issues jsonb NOT NULL,
  PRIMARY KEY (org_id, page_id, checked_at)
);
```

All RLS `FORCE` with leading-edge tenant index (GC6). Raw responses live in Garage via `putArtifact`, keyed from `response_artifact_key`.

## Action kinds registered

| Kind | Default | Notes |
|---|---|---|
| `geo.apply_citability_fix` | gated, streak 10 | Passage restructuring, entity naming, schema additions |
| `geo.update_llms_txt` | gated, streak 6 | Regenerates the served file |
| `geo.update_robots_directive` | gated, opt-in only | Changes crawler access — deliberate policy, never automatic |

## Interfaces

**Consumes:** `upsertPage`, `patchBlock` (W0 publish client), `evaluateAutonomy`, `getTenantConfig`, `putArtifact`.

**Produces:**

```ts
export function runProbes(orgId: string, assistants: AssistantId[]): Promise<ObservationSummary>;
export function shareOfVoice(orgId: string, cluster: string, window: DateRange): Promise<SovReport>;
export function analyseCitability(orgId: string, pageId: string): Promise<CitabilityReport>;
export function generateLlmsTxt(orgId: string): Promise<{ content: string }>;
export function checkCrawlerAccess(orgId: string): Promise<AccessReport[]>;
```

## Admin surface

`app/(admin)/geo/`: citation rate per assistant over time with observation counts shown alongside every rate, a share-of-voice view per prompt cluster, and a citability issue queue. Any figure derived from fewer than the configured minimum observations renders as "insufficient data" rather than a number.

## Testing

- `citation-extractor.test.ts` — brand and competitor detection on fixture responses, including near-miss brand names and unlinked mentions.
- `sov.test.ts` — rates below the minimum observation count return "insufficient data" rather than a percentage.
- `citability.test.ts` — each scored dimension on fixture pages; a JS-only page fails `render_ok`.
- `llms-txt.test.ts` — deterministic generation for a fixed page set.
- `w6-gate.test.ts` — the compliance gate: no code path serves different content to a crawler than to a user (assert one renderer), and `geo.update_robots_directive` cannot reach `auto`.
