# RP-W9 — Free tools and the free audit funnel

Date: 2026-08-13  
Status: approved  
Program: [`2026-08-13-rp-program-design.md`](2026-08-13-rp-program-design.md)  
Depends on: nothing (fully independent — schedule wherever capacity allows)  
Migration range: **200–209**  
Owned paths: marketing-site `app/tools/` routes, `ads-agent/lib/audit-funnel/`

## Problem

Ryze runs a substantial acquisition funnel off free utilities — ad metrics, max CPA, breakeven ROAS and A/B significance calculators, an ad copy grader and generator, a UTM builder, SERP snippet preview, schema generator, keyword clustering, alt-text generator, an AI search visibility checker and an llms.txt generator — plus a "type your domain, we scan everything" free audit that converts into the paid product. We have no equivalent top-of-funnel surface.

## Goals

1. A tools section on the marketing site with utilities that are genuinely useful without signup.
2. A free audit that scans a submitted domain and returns a real, specific issue list.
3. A conversion path from audit result to a qualified enquiry, using the existing lead spine.
4. Reuse: every tool wraps logic that already exists for the paid product rather than reimplementing it.

## Non-goals

- Gating tools behind signup (they are acquisition surfaces; gating defeats the purpose).
- Building new analysis engines. If a tool needs logic the paid product does not have, it is out of scope for this workstream.
- Storing submitted domains or emails beyond what the lead spine already stores under existing consent handling.

## Tool set

Each tool maps to existing logic, which is the reason this workstream is small despite its surface area:

| Tool | Backed by |
|---|---|
| Ad metrics calculator (CPM, CPC, CTR, CVR, CPA, ROAS) | Pure arithmetic module, shared with reporting |
| Max CPA / target ROAS calculator | Margin and AOV maths from the breakeven logic in the decision engine |
| Breakeven ROAS calculator | Same module |
| A/B significance calculator | The stopping-rule statistics from W3/W7 |
| Ad copy grader | W3's per-channel policy validator plus a rubric score |
| UTM builder | Pure string composition with validation |
| SERP snippet preview | W5's title/meta length checks |
| Schema markup generator | W5's structured-data templates |
| Keyword clustering | Existing embedding infrastructure (`lib/ai/client.ts`) |
| Alt-text generator | Existing vision-capable model path |
| AI search visibility checker | W6's `runProbes` for a single prompt, rate-limited |
| llms.txt generator | W6's `generateLlmsTxt` for an arbitrary domain |

Tools that call a model (copy grader, alt text, clustering, visibility checker) are rate-limited per IP and metered through the existing ledger so acquisition spend is visible rather than invisible. Purely computational tools have no backend dependency and run client-side.

## Free audit

A submitted domain is fetched and analysed with the same detectors the paid product runs — W5's issue detector for technical SEO, W6's citability and crawler-accessibility checks, and a public-signal ads check (does a landing page exist for the ads currently running, is conversion tracking present). The result is a prioritised list of specific findings with the evidence for each, not a score with a paywall. The conversion offer is the fix, not the finding.

Two constraints keep this honest and safe. The crawler identifies itself, respects `robots.txt`, and is bounded to a small page budget per domain — we do not want a free tool behaving like an unwanted scraper. And findings are only reported when the detector has actual evidence; a check that could not run reports "not checked", never a default failure used to manufacture urgency.

## Data model (migration 200)

```sql
CREATE TABLE adsagent.audit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  requester_ip_hash text NOT NULL,
  state text NOT NULL DEFAULT 'queued'
        CHECK (state IN ('queued','running','complete','failed','refused')),
  findings jsonb,
  lead_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX ON adsagent.audit_requests (requester_ip_hash, created_at DESC);
```

This table is not tenant-scoped — audits are anonymous by nature — so it sits outside the RLS pattern deliberately, holds no personal data beyond a hashed IP, and `lead_id` is populated only when the visitor voluntarily submits contact details through the existing lead capture. The `refused` state records domains declined for robots or rate reasons, so refusals are auditable rather than silent.

## Conversion path

The audit result page offers the existing lead capture, pre-filled with the audited domain and the top findings as context. Submission flows through the site's current WhatsApp handoff and lead spine unchanged (`lib/leads/whatsapp-handoff.ts`) — this workstream adds a context payload, not a new capture path.

## Interfaces

**Consumes:** `auditSite` detectors (W5), `analyseCitability` / `checkCrawlerAccess` / `generateLlmsTxt` / `runProbes` (W6), W3's copy validator, existing lead capture, metering ledger.

**Produces:**

```ts
export function requestAudit(domain: string, ipHash: string): Promise<{ auditId: string; state: AuditState }>;
export function getAudit(auditId: string): Promise<AuditResult>;
export function gradeAdCopy(input: AdCopyInput): Promise<{ score: number; findings: CopyFinding[] }>;
export function clusterKeywords(keywords: string[]): Promise<KeywordCluster[]>;
```

Because W9 consumes W5/W6/W3 entry points, it can be built against their published signatures and integrated when they land; until then each dependency is exercised through a stub in tests. Tools with no such dependency ship immediately.

## Error handling

An unreachable domain, a robots refusal or a timeout each produce a specific, honest state rather than a generic failure. Rate-limited callers receive a clear message with a retry time. Model-backed tools degrade to their deterministic checks when the provider is unavailable — the copy grader still reports length and count violations without a model.

## Testing

- `calculators.test.ts` — every formula against worked examples, including division-by-zero and negative-margin inputs.
- `audit-crawler.test.ts` — robots respected, page budget enforced, identifying user agent sent, refusal recorded.
- `findings.test.ts` — a check that cannot run reports "not checked" and never a failure.
- `ratelimit.test.ts` — per-IP-hash limiting across model-backed tools.
- `w9-gate.test.ts` — no tool stores a submitted domain against a person without an explicit lead submission, and every model-backed call is metered.
