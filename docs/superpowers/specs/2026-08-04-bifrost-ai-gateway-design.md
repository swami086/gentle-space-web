# Bifrost AI Gateway on the GCP VM (Design Spec)

**Date:** 2026-08-04
**Status:** Approved for implementation

## Decisions (confirmed)

1. **VM resize:** `e2-standard-2` (2 vCPU / 8GB, ~$59/mo).
2. **VM testing:** direct SSH + curl smoke test against the Bifrost gateway; `ads-agent` stays
   local-only for now (not deployed to the VM as part of this spec).
3. **Bifrost UI/API access:** internal-only — no Caddy route, no public exposure. Reachable only via
   SSH tunnel / `docker exec` from the VM.
4. **Model aliases:** three tiers — `cheap` = `gemini-2.5-flash-lite` (SIMPLE/MEDIUM), `complex` =
   `gemini-2.5-flash` (COMPLEX tier), `reasoning` = `gemini-2.5-pro` (REASONING tier). Fallback chain:
   `cheap` → `complex` → `reasoning` on error/malformed output.
5. **Config source of truth:** checked-in `config.json` (secrets via `env.` refs) is the source of
   truth — routing/model changes go through `git push`, not live UI edits.

**Related:** supersedes the gateway-options discussion from
[`2026-08-03-ads-agent-vertex-ai-migration-design.md`](2026-08-03-ads-agent-vertex-ai-migration-design.md)
(that spec's "Files touched" for `ads-agent`'s Vertex client become largely dormant/replaced here).

## Problem

`ads-agent`'s two LLM call sites (`campaign-chat.ts`, `rationale.ts`) each hand-roll a JWT-bearer
Vertex client (`lib/vertex/auth.ts` + `lib/vertex/client.ts`) and, after the `MALFORMED_FUNCTION_CALL`
debugging session, a one-off silent-retry (`topUpDescriptions`) to paper over Gemini quirks. There's
no general mechanism to escalate a genuinely complex/reasoning-heavy prompt to a stronger model, and
every future agent (e.g. the not-yet-built WhatsApp lead-qualification agent) would have to reinvent
this from scratch.

You want a shared, self-hosted **AI gateway** — [Bifrost](https://github.com/maximhq/bifrost) — running
on the existing GCP VM, that:

- Auto-classifies each incoming prompt and routes cheap/simple ones to `gemini-2.5-flash-lite` and
  complex/reasoning ones to a stronger model, with no per-call-site retry code (decision from the
  previous round: scope = all future agents, routing = auto-classify, infra = same VM).
- Is reachable by `ads-agent` today and any future agent later through one OpenAI-compatible endpoint.
- Reuses the existing Vertex AI project/service-account — no new credential story.

## Why Bifrost (confirmed via its docs, not just the GitHub README)

| Requirement | Bifrost capability |
|---|---|
| Auto-classify per prompt (no extra LLM call) | **Complexity Router** — in-process keyword/heuristic scoring into `SIMPLE`/`MEDIUM`/`COMPLEX`/`REASONING` tiers, <1ms overhead, zero external calls. Exposed as `complexity_tier` in a CEL routing-rule engine. |
| Escalate on failure too | **Automatic Fallbacks** — independent of the complexity router; retries on a different model/provider on error. Both mechanisms can be combined. |
| Reuse existing Vertex service account | Native `vertex` provider; `vertex_key_config.auth_credentials` takes the service-account JSON directly (`env.` reference), or Application Default Credentials. Handles token refresh itself. |
| Keep the JSON-controlled-generation fix (`responseMimeType`/`responseSchema`) that fixed the stuck-chat bug | OpenAI's `response_format: {type:"json_schema", json_schema:{...}}` is transformed to Gemini/Vertex's `responseMimeType` + `responseJsonSchema` automatically. Confirmed supported for both Gemini and Vertex-Gemini in Bifrost's own test-harness coverage table. |
| Low footprint on a memory-constrained VM | Go binary, ~80–113MB Docker image, <15µs overhead at 5k RPS (we're nowhere near that volume) — much lighter than LiteLLM's Python/FastAPI stack for the same job. |
| No new external DB | Default config store is **SQLite**, file-based, no Postgres/Redis required for our scale. |
| Works for "all future agents" | Single OpenAI-compatible `/v1/chat/completions` endpoint — any language/SDK just swaps `base_url`. |

## Current VM state (checked before sizing)

```
gentle-space-web · e2-medium (2 vCPU, 4GB RAM) · asia-south1-a · 100GB disk (77GB free)

Running containers:
  gentle-space-caddy   (reverse proxy)
  gentle-space-web     (main Next.js app)
  gentle-space-pg      (main app's Postgres)
  twenty-server-1, twenty-worker-1, twenty-db-1, twenty-redis-1  (Twenty CRM, 4 containers)
  buildx_buildkit_gentlebuilder0

Memory: 2.7Gi used / 3.8Gi total → only 923Mi free, 1.1Gi "available" (buff/cache reclaimable)
```

**There is effectively no memory headroom today.** CPU is not the observed bottleneck — this VM has
never shown CPU pressure in this session's checks. `ads-agent` itself is **not** deployed to this VM
(it's local-dev-only today); this spec adds only the Bifrost container.

## VM resize (proportional to the actual constraint: memory, not CPU)

| Option | vCPU | RAM | Mumbai (asia-south1) $/mo, on-demand | Verdict |
|---|---|---|---|---|
| e2-medium (current) | 2 | 4GB | ~$29 | No headroom — adding any new container risks OOM |
| **e2-standard-2 (recommended)** | 2 | 8GB | ~$59 | Same vCPU count, **doubles memory** — Bifrost fits comfortably (512MB–1GB is generous for our traffic) with real headroom left over |
| e2-highmem-2 | 2 | 16GB | ~$85 (est.) | Same vCPU, 4× memory — no CPU benefit, memory well beyond what a low-traffic gateway needs |
| e2-standard-4 | 4 | 16GB | ~$115 (est.) | Doubles CPU too, which nothing here is bound on |

**Recommendation: resize to `e2-standard-2`.** ~$30/mo increase, keeps the same vCPU count (no
GOMAXPROCS/scheduling behavior change for existing containers), and leaves ~4GB of genuine headroom
for Bifrost plus future growth (an eventual `ads-agent` deployment, the WhatsApp agent, etc.) instead
of a one-shot fix that's immediately tight again.

`gcloud compute instances set-machine-type` requires the VM to be stopped — this is a few minutes of
downtime for the whole VM (main site + Twenty CRM), needs to happen in a scheduled window, not silently
mid-implementation.

## Architecture

```
gentle-space-web VM (resized to e2-standard-2)
├── gentle-space-caddy        (unchanged — reverse proxy, public routes)
├── bifrost                   NEW — joins the existing `gentle_space_net` network
│   │                         Docker image maximhq/bifrost, ~100MB
│   ├── config_store: sqlite (file, no new DB)
│   ├── provider: vertex
│   │     project_id: propane-galaxy-498403-n8 (reused, not a new project)
│   │     region: us-central1
│   │     auth_credentials: env.VERTEX_SA_JSON (same service-account key already in use)
│   ├── model aliases
│   │     "cheap"     → vertex/gemini-2.5-flash-lite   (default — SIMPLE/MEDIUM tier)
│   │     "complex"   → vertex/gemini-2.5-flash        (COMPLEX tier)
│   │     "reasoning" → vertex/gemini-2.5-pro          (REASONING tier)
│   ├── routing rule:  complexity_tier == "REASONING" → "reasoning"
│   │                  complexity_tier == "COMPLEX"   → "complex"
│   │                  else (SIMPLE/MEDIUM/unknown)   → "cheap"
│   ├── fallback chain: "cheap" fails → "complex" → "reasoning" (escalate on error/malformed output)
│   └── resource limits: 1 CPU / 512MB container (GOMEMLIMIT=450MiB per Bifrost's own sizing table)
│         — internal-only: bound to the docker network, no public Caddy route, port 8080 not exposed
│         on the host beyond what other containers on gentle_space_net need
├── gentle-space-web           (unchanged this phase — still calls Vertex directly; see Non-goals)
├── gentle-space-pg            (unchanged)
└── twenty-*                   (unchanged)

Local dev (ads-agent/):
└── docker-compose.yml gains a `bifrost` service alongside the existing `db` service, same config
    shape as prod, pointed at the same Vertex project — so "develop locally, test, then deploy via
    Git" is a real workflow: config.json is one file, used both locally and on the VM.
```

## Scope (this spec)

1. **Stand up Bifrost** — local (`ads-agent/docker-compose.yml`) and VM (new compose service on
   `gentle-space-web`), Vertex provider configured, two model aliases, one complexity-routing rule,
   one fallback rule. Config lives in a checked-in `config.json` (secrets referenced via `env.`, never
   committed) so both environments start from the same source of truth — satisfies "deploy via Git."
2. **Migrate `ads-agent`'s two LLM call sites** off the hand-rolled Vertex client onto Bifrost's
   OpenAI-compatible endpoint:
   - `campaign-chat.ts`: its existing `DRAFT_RESPONSE_SCHEMA` JSON-controlled-generation approach maps
     directly to OpenAI's `response_format: {type:"json_schema", json_schema:{...}}` — the schema and
     validation logic (`parseDraftJson`, `sanitizeReply`, `claimsCopyWithoutFields`) don't change, only
     the transport (fetch to Bifrost instead of fetch to Vertex directly) and response parsing
     (`choices[0].message.content` instead of `candidates[0].content.parts[].text`).
   - `rationale.ts`: same transport swap, plain-text response, no schema involved.
   - The existing `topUpDescriptions` silent retry **stays** — it recovers from the model *succeeding*
     but under-filling one field, which is a business-logic completeness check, not a
     transport/model failure Bifrost's fallback would catch.
   - `ads-agent/lib/vertex/auth.ts` (hand-rolled JWT signing) is deleted entirely — Bifrost holds and
     refreshes the credential, `ads-agent` no longer needs `node:crypto` JWT code at all.
3. **VM resize** to `e2-standard-2` (pending your confirmation below).
4. **Docs/env updates**: `ads-agent/.env.example`, `README.md`, `env-status.ts` (the "Vertex AI
   configured" check becomes "Bifrost reachable + configured," since `ads-agent` itself no longer
   holds Vertex credentials directly).

## Non-goals (this spec)

- **Migrating the main `GentleSpace_Web` app's `lib/ai/client.ts` facade** (7 call sites: lead
  qualification, search-query rewrite, entity extraction ×2, listing-fit insight, embeddings —
  spanning `app/api/leads/`, `app/api/spaces/{insight,search}/`, `lib/graph/rebuild.ts`,
  `lib/search/retrieve.ts`, `lib/spaces/insight.ts`, `lib/sync/embed-listings.ts`). This code is
  stable, already dual-provider (Vertex + OpenAI fallback via `aiProvider()`), and has no known pain
  point — Bifrost is available to it later with zero code changes beyond swapping the base URL
  (OpenAI-compatible), but touching working code for no reason isn't in scope now.
- **`lib/vertex/batch.ts`** (GCS-based async batch-prediction for bulk entity extraction, used by
  `scripts/{submit,poll,apply}-entity-extraction.ts`) — a fundamentally different pattern (submit a
  job, poll GCS, no `generateContent` call in the hot path). Bifrost's gateway model doesn't apply
  here; left untouched.
- **Deploying `ads-agent` itself to the VM.** It stays local-dev-only; this spec only adds the
  gateway container. See Open Question 2 below — this affects how "deployed and tested on the VM"
  can actually be verified.
- **Bifrost enterprise features** (OIDC/SSO, budget governance, semantic caching, clustering) — not
  needed at this scale; the OSS gateway alone covers everything in scope.
- **Public exposure of Bifrost's API/UI** — internal-only on `gentle_space_net` by default (see Open
  Question 3).

## Credentials & security

- Reuses the existing service-account JSON already provisioned for `propane-galaxy-498403-n8` — the
  same key `ads-agent` and the main app already use. No new GCP credential.
- Passed to Bifrost via `vertex_key_config.auth_credentials` referencing an env var
  (`env.VERTEX_SA_JSON`), sourced from `.env.production` on the VM (not committed) and `.env.local`
  locally — same secret-handling pattern already used everywhere else in this repo.
- Will confirm during implementation that the service account is scoped to `roles/aiplatform.user`
  only (least privilege) — not verified yet, flagged per the cloud-architect security checklist.
- Bifrost's own gateway API has no built-in auth in the OSS tier by default — it must **not** get a
  public Caddy route without adding a layer in front of it (basic auth, IP allowlist, or SSH-tunnel-only
  access). Default posture in this spec: internal Docker network only, nothing in the `Caddyfile`.

## Testing plan

- **Local:** `docker compose -f ads-agent/docker-compose.yml up bifrost`, seed `config.json`, hit
  `POST http://localhost:8080/v1/chat/completions` directly with a real Vertex call before touching
  any app code — confirms the gateway/provider/credential wiring works in isolation.
- **Unit tests:** rewrite `campaign-chat.test.ts` / `rationale.test.ts` to mock `fetch` returning
  OpenAI-shaped responses (`choices[].message.content`) instead of today's Gemini-shaped fixtures —
  net simplification, since OpenAI's response shape is what these tests already partially resemble
  from the pre-Vertex-migration version.
- **Routing verification:** send one deliberately SIMPLE prompt and one deliberately COMPLEX/REASONING
  prompt (e.g. "reason step by step about audience segments and draft 15 headlines + 4 descriptions")
  through the local gateway, confirm via Bifrost's logs/UI which model alias actually served each one.
- **Fallback verification:** temporarily misconfigure the "cheap" alias (bad model name) to confirm
  the fallback chain actually escalates to "complex"/"reasoning" rather than erroring out.
- **VM deploy:** push to `main`, VM's existing git-bundle sync pulls it, `docker compose up -d bifrost`
  on the VM, smoke-test via SSH + curl against the internal endpoint (no deployed `ads-agent` on the
  VM to test through end-to-end — confirmed acceptable for this phase).

## Implementation order

1. `ads-agent/bifrost/config.json` (shared local + prod) — provider, 3 model aliases, routing rule,
   fallback chain, SQLite config store.
2. `ads-agent/docker-compose.yml` — add `bifrost` service, env var for the service-account JSON.
3. Local smoke test: real Vertex call through `http://localhost:8080/v1/chat/completions` for all
   three tiers, and one fallback-triggering test, before touching any app code.
4. Rewrite `campaign-chat.ts` + `rationale.ts` to call Bifrost instead of `lib/vertex/client.ts`.
5. Delete `ads-agent/lib/vertex/auth.ts` and prune `lib/vertex/client.ts` to whatever (if anything)
   is still needed.
6. Rewrite `campaign-chat.test.ts` / `rationale.test.ts` fixtures to OpenAI response shape.
7. Update `.env.example`, `README.md`, `env-status.ts`.
8. `npm test` in `ads-agent/`, fix any fallout.
9. VM: resize to `e2-standard-2` (scheduled downtime), add the `bifrost` service to the VM's compose
   stack, deploy via the existing git-bundle sync, SSH + curl smoke test.
