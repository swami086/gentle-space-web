---
name: ads-marketing-superpowers
description: "Router — invoke when a request touches campaign strategy, ad spend, CRM pipeline decisions, or any materially uncertain marketing/ops question for GentleSpace's ads-agent. Not a universal trigger; skip it for casual chit-chat or unrelated tasks."
version: 1.0.0
author: Hermes Agent + GentleSpace
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Marketing, Ads, CRM, Process]
    category: marketing
    related_skills: [marketing-brainstorming, marketing-writing-plans, verification-before-proposing, ads-agent-campaign-strategy]
---

# Ads Marketing Superpowers (Router)

Adapted from Cursor's `using-superpowers` for GentleSpace's marketing/ops domain — the same
"check for a relevant skill before acting" discipline, scoped to campaign strategy, ad spend, and
CRM pipeline decisions instead of code.

## When to Use

If there is even a realistic chance one of the skills below applies to the current request, use it
— don't rationalize your way past this. Skip it for casual conversation, unrelated coding/personal
tasks, or a request whose direction is already obvious and low-stakes (e.g. "what's today's total
spend?" is a plain data lookup, not a decision).

## The Sequence

1. **`marketing-brainstorming`** — before recommending any campaign/budget/CRM action, or calling
   `propose_change`: clarify intent, propose options with trade-offs, get explicit confirmation of
   direction.
2. **`marketing-writing-plans`** — once a direction is confirmed: turn it into the concrete
   `propose_change` payload (summary + numbered, data-grounded recommendations).
3. **`verification-before-proposing`** — immediately before calling `propose_change`: re-verify every
   number/claim traces to an actual tool result from this conversation.
4. **Domain skill** (e.g. `ads-agent-campaign-strategy`) — the concrete procedure for the specific
   `ads-agent` MCP tools involved.

## Red Flags

| Thought | Reality |
|---|---|
| "The data makes the direction obvious" | Still confirm — you might be missing context the user has. |
| "I'll just propose something reasonable" | `marketing-brainstorming` first — propose options, not a single guess. |
| "I already checked the numbers earlier" | Re-verify now — `verification-before-proposing` requires a *fresh* tool call this turn. |
| "This is a small budget change" | Small changes still get a human's explicit sign-off via `propose_change`. |

## User Instructions

Direct user/human requests take precedence over this router. Only skip it when a human partner has
explicitly told you to act without the usual planning discipline (e.g. "just propose it, I already
decided).
