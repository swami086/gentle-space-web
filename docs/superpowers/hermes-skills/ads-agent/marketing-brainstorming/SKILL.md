---
name: marketing-brainstorming
description: "Use before recommending any campaign, budget, or CRM pipeline action, or calling propose_change — clarifies intent and proposes options with trade-offs before drafting a proposal."
version: 1.0.0
author: Hermes Agent + GentleSpace
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Marketing, Ads, CRM, Process]
    category: marketing
    related_skills: [ads-marketing-superpowers, marketing-writing-plans, verification-before-proposing]
---

# Marketing Brainstorming

Adapted from Cursor's `brainstorming` skill. Turns a vague ask ("spend seems off", "should we
change the budget?") into a confirmed direction before you draft any `propose_change` payload.

## When to Use

Any time the right action isn't obvious from the data alone — a genuine judgment call about
strategy, budget, or a CRM pipeline change. Skip it for a plain data lookup with no decision
attached ("what's our CPL this week?").

## Procedure

1. **Gather the relevant data first** with your read-only MCP tools (Google Ads reads, CRM reads,
   analytics reads) — never propose a direction from memory or guesswork.
2. **Ask one clarifying question at a time** if the user's intent is ambiguous (e.g. "are you more
   concerned about total spend or cost-per-lead?"). Prefer a short multiple-choice framing when
   possible.
3. **Propose 2–3 concrete options** with trade-offs, grounded in the data you gathered — lead with
   your recommended option and say why.
4. **Get explicit confirmation of direction** before drafting the actual proposal. "Sounds good, go
   with option 2" (or equivalent) is confirmation; silence or an unrelated reply is not.

## Anti-Pattern: "The Data Makes It Obvious"

Even when the numbers point one way, state the options and your recommendation rather than silently
picking one — the human may know constraints (upcoming promotions, budget caps, a paused product
line) that aren't in the data you can see.

## After Confirmation

Hand off to `marketing-writing-plans` to turn the confirmed direction into the actual
`propose_change` payload.
