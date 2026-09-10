# PSW Chaos Cards v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Scrap and rebuild P1–P4 (`143:3–6`) as dark hybrid lookalikes with new compositions.  
**Architecture:** Shared token strip → clear frames → 4 parallel Sonnet Figma rebuilds → screenshot QA.  
**Tech:** Figma MCP (`use_figma`, `get_screenshot`), logo kit `136:2`, Mobbin refs.  
**Spec:** `docs/superpowers/specs/2026-09-05-broker-os-psw-chaos-cards-v2-design.md`

**Skills for subagents:** `figma-use`, `figma-generate-design`, `high-end-visual-design`, `design-taste-frontend`, `verification-before-completion`  
**Model:** `claude-4.5-sonnet-thinking` (or inherit Sonnet) — no Opus

## File / node map

| Artifact | ID / path |
|----------|-----------|
| Board | `143:2` |
| P1–P4 | `143:3` `143:4` `143:5` `143:6` |
| Logo kit | WA `136:8` Meta `137:11` FB `137:5` |
| Spec | `docs/superpowers/specs/2026-09-05-broker-os-psw-chaos-cards-v2-design.md` |

---

### Task 0: Token strip + clear frames

**Model:** parent / Sonnet  
**Skills:** `figma-use`

- [ ] **Step 1:** Create `Asset / Chaos Dark Tokens` near logo kit (swatches + notes for surfaces/text/accents)
- [ ] **Step 2:** Clear all children of `143:3–6`; set frame fills `#191A1B`, radius 14, clipsContent true
- [ ] **Step 3:** Write briefs `.superpowers/sdd/chaos-v2-p{1-4}-brief.md`

---

### Task 1–4: Parallel rebuilds (Wave A ×4)

**Parallel:** yes — max 4  
**Model:** Sonnet each

#### Task 1 — P1 (`143:3`)
- [ ] Clear already done; build Mail → Meta → WA stack with logos + badges 7/3/12, tilt ≤6°
- [ ] Screenshot QA; report `.superpowers/sdd/chaos-v2-p1-report.md`

#### Task 2 — P2 (`143:4`)
- [ ] Dark Ads Manager: nav + empty fields + ₹ + strikethrough calendar + Meta logo
- [ ] Screenshot QA; report `.superpowers/sdd/chaos-v2-p2-report.md`

#### Task 3 — P3 (`143:5`)
- [ ] Spend ₹50,000 / ??? / No activity / Which ad?
- [ ] Screenshot QA; report `.superpowers/sdd/chaos-v2-p3-report.md`

#### Task 4 — P4 (`143:6`)
- [ ] Dark WA thread + Missed · 6 days + WA logo
- [ ] Screenshot QA; report `.superpowers/sdd/chaos-v2-p4-report.md`

---

### Task 5: Parent board QA

- [ ] `get_screenshot` on each P + board `143:2`
- [ ] Fail if any hard-fail from spec
- [ ] Update `.superpowers/sdd/progress.md`
- [ ] No commit unless user asks
