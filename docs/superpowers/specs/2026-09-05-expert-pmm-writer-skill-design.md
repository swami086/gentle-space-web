# Expert PMM Writer Skill — Design

**Date:** 2026-09-05  
**Status:** Approved  
**Location:** `~/.cursor/skills/expert-pmm-writer/` (Cursor global skills catalog)  
**Invoke:** `/expert-pmm-writer`

## Goal

Give the agent a single `/` skill that writes or rewrites marketing copy (landing, ads, email, CTAs, section copy) in the voice of a skilled human product marketer — clear, specific, customer-language, anti-slop — without running a full positioning workshop.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Primary job | **A** — Write/rewrite marketing copy |
| Architecture | **1** — Standalone skill (does not chain other skills) |
| Approach | **A** — Workflow skill (brief → craft → voice → anti-slop → deliver) |
| Auto-invoke | Off (`disable-model-invocation: true`) |
| Related skills kept separate | `product-marketing` (context doc), `copywriting`, `content-humanizer`, `ai-writing-auditor` |

## Research inputs

- Style unbundling + role specificity (Lenny / Mike Taylor prompt tactics)
- Anti-slop vocabulary and structure bans (Will Francis / Wikipedia AI-writing research patterns)
- Positioning-aware copy discipline without full Dunford workshop (value for a defined customer vs alternatives)
- Existing catalog patterns from `copywriting` and `content-humanizer`

## Non-goals

- Full ICP / positioning document creation (use `/product-marketing`)
- SEO content production workflows
- Pure AI-tell auditing without rewrite (use `/ai-writing-auditor`)

## Skill package

```
~/.cursor/skills/expert-pmm-writer/
├── SKILL.md
├── references/voice-and-craft.md
├── references/anti-slop.md
└── scripts/check_ai_signs.py   # mechanical gate; exit 0 required
```

## Runtime pipeline

1. Load `.agents/product-marketing.md` (or legacy paths) if present
2. Brief intake: ask only for missing artifact type, audience, goal/CTA, proof, constraints
3. Draft with expert PMM craft (customer language, benefit > feature, specificity)
4. Apply human PMM voice traits
5. Hard anti-slop detect/rewrite until clean
6. Run `scripts/check_ai_signs.py` (must exit 0)
7. Deliver: primary draft + 2 headline/CTA alternatives + why-this-works + audit line

## Success criteria

- Discoverable as `/expert-pmm-writer` in Cursor
- SKILL.md under 500 lines; progressive disclosure to references
- Description includes WHAT + WHEN (third person)
- Output reads human on a press-release / AI-tell check
- Zero em/en dashes in delivered copy (mechanical check)

## Update 2026-09-05: AI-sign hard gate

Research (Firecrawl): Wikipedia Signs of AI writing, Field Guide to AI Slop, Will Francis.

Change: detect/rewrite gate via `references/anti-slop.md`; deliver with audit attestation.

## Update 2026-09-06: zero em-dash + mechanical check

User still saw em dashes. Causes: skill allowed "max one"; skill docs contained real em dashes that models imitate.

Research: Run The Prompts (comma/period replacement), Jodie Cook (never for any reason), avoid-ai-writing (target zero).

Change: absolute ban on U+2014, U+2013, and prose ` -- `; skill files rewritten without those characters; required `scripts/check_ai_signs.py` exit 0; rule-of-three and Tier-2 = zero for marketing copy.
