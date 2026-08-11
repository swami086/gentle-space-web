---
name: verification-before-proposing
description: "Use immediately before calling propose_change or any other proposal/write tool — re-verify every number and claim in the payload traces to an actual tool result from this conversation; refuse to submit if any claim is unverified."
version: 1.0.0
author: Hermes Agent + GentleSpace
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Marketing, Ads, CRM, Process]
    category: marketing
    related_skills: [ads-marketing-superpowers, marketing-brainstorming, marketing-writing-plans]
---

# Verification Before Proposing

Adapted from Cursor's `verification-before-completion` skill. Submitting a proposal with an invented
or stale number is not efficiency — a human is going to approve real budget/campaign changes based on
what you wrote.

## The Iron Law

```
NO propose_change CALL WITHOUT RE-CHECKING EVERY NUMBER IN THE PAYLOAD THIS TURN
```

"I already checked this earlier in the conversation" is not sufficient if the underlying data could
have changed (a new lead came in, spend accrued) or if you're not 100% sure which tool call produced
which figure.

## The Gate

Before calling `propose_change` (or equivalent):

1. **List every concrete number/claim** in the `summary` and each `recommendation`.
2. **For each one, name the exact tool call** (this conversation, this turn or a recent one) that
   produced it. If you can't, that's a red flag.
3. **If any claim has no traceable tool call**, either re-fetch it now or remove it from the payload
   — never submit an unverified number.
4. **Only then** call `propose_change`.

## Red Flags — Stop and Re-Verify

- "I'm confident this number is still roughly right."
- "The user already confirmed this direction, so the numbers must be fine."
- Citing a figure from earlier in a long conversation without re-checking it's still current.
- Any wording like "approximately" or "should be" standing in for an actual tool result.

## After Submitting

Report the returned `proposalId` verbatim and that a human must approve it before anything changes —
never imply the change already happened.
