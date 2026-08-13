# S13 Gate — Generative surfaces (F1–F5)

**Branch:** feat/s13-t12 (integration tip `32a89d0`)  
**Date:** 2026-08-13  
**Plan:** [`2026-08-13-s13-generative-surfaces.md`](../plans/2026-08-13-s13-generative-surfaces.md)  
**Vitest gate:** `ads-agent/lib/generative/s13-gate.test.ts`

## Checklist (build sequence S13)

1. **OpenUI analytics/campaign tools use session Scope** — **PASS**  
   `createAnalyticsToolProvider(scope)` / `createCampaignToolProvider(scope)` close over guard scope; tool args carrying `orgId` do not change tenant. `/api/openui/tools` calls `createPlatformToolProvider(access.scope)` — no `ADS_AGENT_ORG_ID` on the request path. Covered by `analytics-tools.test.ts`, `campaign-tools.test.ts`, `platform-tools.test.ts`, `app/api/openui/tools/route.test.ts`, and gate assertions.

2. **Why / Ask / call-prep fail closed when citation ∉ pack** — **PASS**  
   `assertCitationsAllowed` throws `citation_not_in_pack`; `buildCallPrep` gates every point; Bifrost output with foreign ids falls back to the deterministic template. `extractClaimIdsFromOpenUi` + gate test reject foreign claim ids in OpenUI Lang.

3. **ActionProposal cannot navigate off-origin or via `javascript:`** — **PASS**  
   `resolveActionProposalClick` only navigates to safe relative paths (`/` prefix, no `//`, no scheme). External http(s) and `javascript:` hrefs resolve to `{ kind: "noop" }`. Wired through `WhyPanel` `onAction` → `parseActionProposalPayload` + `resolveActionProposalClick`.

4. **Persisted answer reloadable by id under RLS** — **PASS**  
   Migration `111_generative_answers.up.sql`: `adsagent.generative_answers` with `ENABLE` + `FORCE ROW LEVEL SECURITY` and `tenant_isolation` policy on `public.current_tenant()`. `insertGenerativeAnswer` / `getGenerativeAnswer` / `listGenerativeAnswers` take `Scope` first and run inside `withTenantTransaction`. WhyPanel loads `GET /api/generative/answers/[id]` on refresh (`?why=`).

5. **AskAiTrigger has ≥1 real call site** — **PASS**  
   `components/generative/WhyPanel.tsx` imports and renders `<AskAiTrigger question={…} onAsk={…} />`; mounted from `app/(admin)/proposals/[id]/page.tsx`.

## Command

```bash
cd ads-agent && npx vitest run lib/generative/s13-gate.test.ts
```

## Deferred / notes for final review

- Apply migration **111** before relying on persisted Why/Ask/call-prep in prod.
- Bifrost-backed Why/Ask copy is v1 template-first when unavailable; live model smoke is operator-run (same posture as S10/S12 Hermes E2E).
- Call-prep block mounted on CRM surface (`CallPrepBlock`); full Enquiries IA remains out of scope (S13-D7 partial).
