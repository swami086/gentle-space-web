---
name: marketing-writing-plans
description: "Use once a campaign/budget/CRM direction is confirmed (via marketing-brainstorming) — turns it into the concrete propose_change payload: one-paragraph summary plus numbered, data-grounded recommendations."
version: 1.0.0
author: Hermes Agent + GentleSpace
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Marketing, Ads, CRM, Process]
    category: marketing
    related_skills: [ads-marketing-superpowers, marketing-brainstorming, verification-before-proposing]
---

# Marketing Writing Plans

Adapted from Cursor's `writing-plans` skill. Where `marketing-brainstorming` settles *what* to do,
this skill settles exactly *what to submit* — assume whoever approves the proposal (a human on
`ads-agent`'s `/proposals` page) has no memory of this conversation and only sees the payload.

## When to Use

Immediately after a direction is confirmed via `marketing-brainstorming`, before calling any
`propose_change`-shaped tool (`ads-agent`'s Google Ads `propose_change`, or an equivalent write tool
on another MCP server).

## Payload Shape

- **`summary`** — one paragraph a human can read in 10 seconds and understand what's being proposed
  and why. No jargon that assumes they were part of this conversation.
- **`recommendations`** — a numbered list; each entry has a short `title`, a `rationale` that names
  the *specific* data point behind it (a number, a date range, a campaign/lead name — not "the data
  suggests"), and, where applicable, a concrete `suggestedAction`.
- Every number in the payload must be traceable to a tool call made earlier in this conversation —
  if you can't point to which tool call produced a figure, don't include it (or go re-fetch it).

## No Placeholders

Never submit a recommendation like "optimize the campaign" or "review performance" — say exactly
what should change (which campaign, which field, which direction, by how much) and why, in terms of
the actual numbers you pulled.

## After Drafting

Run `verification-before-proposing` immediately before the actual submit call.
