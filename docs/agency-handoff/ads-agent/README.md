# ads-agent — Agency handoff pack

Linear-ready issues + engineering DOCX for external continuation of **ads-agent only**.

**Baseline:** `b06aba4` on `https://github.com/swami086/gentle-space-web`  
**Access:** Agency gets repo + runbooks; client keeps production secrets; local `AUTH_BYPASS` + sandbox Meta/Google credentials provisioned by client.  
**Label:** `ads-agent`

## Artifacts

| File | Purpose |
|------|---------|
| `ENGINEERING-HANDOFF.docx` | Engineering report + **§12 full issue catalog** (all AC) |
| `ISSUES.docx` | Standalone issues catalog (index + every story + AC) |
| `linear-epics.csv` | 4 epics (Phase A–D) for Linear CSV import |
| `linear-issues.csv` | Stories with embedded AC + spec links |
| `linear-issues.json` | Source of truth (edit here, re-run generator) |
| `generate.mjs` | Regenerates CSV + both DOCX from JSON |

## Regenerate

```bash
cd docs/agency-handoff/ads-agent
npm install   # once — docx dep
node generate.mjs
```

## Linear import

1. Create (or open) Linear project / team slice labeled **ads-agent**.
2. Import **`linear-epics.csv`** first (CSV import → map columns below).
3. Import **`linear-issues.csv`**.
4. Manually parent issues under epics (or use Linear relations). Epic IDs in descriptions: `EPIC-A` … `EPIC-D`. Issue IDs: `AA-001` ….
5. Wire **Blocked by** from each issue’s description / JSON `blockedBy` arrays (CSV does not carry native Linear blockers).

### Column mapping

| CSV column | Linear field |
|------------|--------------|
| Title | Title |
| Description | Description (markdown) |
| Priority | Priority (`Urgent` / `High` / `Medium` / `Low`) |
| Status | Status (default `Backlog`) |
| Estimate | Estimate (points) |
| Labels | Labels (comma-separated) |

### Phase order

| Phase | Epic | Focus |
|-------|------|--------|
| A | EPIC-A | Meta Marketing API sandbox dogfood |
| B | EPIC-B | Google Ads test-customer dogfood |
| C | EPIC-C | Desk + Hermes Copilot reliability |
| D | EPIC-D | Broader backlog |

## Issue index (quick)

**Phase A — Meta:** AA-001 … AA-006  
**Phase B — Google:** AA-010 … AA-013  
**Phase C — Desk/Hermes:** AA-020 … AA-025  
**Phase D — Backlog:** AA-030 … AA-035  

Full AC live in `linear-issues.json` and in each CSV Description under `## Acceptance criteria`.

## Do not commit

- `.env.local`, Meta/Google tokens, refresh tokens, production DB URLs.
- Client-provisioned sandbox secrets (deliver out-of-band).
