---
name: ads-agent-campaign-strategy
description: "Review Google Ads performance and submit campaign strategy recommendations to ads-agent for human approval."
version: 1.1.0
author: Hermes Agent + GentleSpace
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Google Ads, Marketing, Proposals, MCP]
    category: marketing
    related_skills: [ads-marketing-superpowers, marketing-brainstorming, marketing-writing-plans, verification-before-proposing]
---

# Ads Agent Campaign Strategy

`ads-agent` (a separate service at GentleSpace Solutions) exposes a Google Ads MCP server with 3
read tools and exactly one write tool, `propose_change`. This skill is the *only* way you may affect
`ads-agent` — you never have access to its 4 direct write tools (`create_campaign`, `pause_campaign`,
`update_campaign_budget`, `add_negative_keyword`); they are not registered to you at all. Every
change you propose becomes a `pending` row a human must approve before anything real happens.

## When to Use

Use when asked to review Google Ads performance, investigate search terms, or suggest a campaign
strategy for the ads-agent account.

## Prerequisites

The `ads_agent` MCP server must be connected (`mcp_ads_agent_*` tools visible). If it isn't, tell the
user to run `docker compose up -d google-ads-mcp` from the `ads-agent` directory and then `/reload-mcp`.

## Procedure

① **Gather data** with the read tools — never guess:
- `mcp_ads_agent_list_campaign_performance` — cost, clicks, impressions, conversions per campaign
- `mcp_ads_agent_search_terms_report` — search terms driving traffic/spend
- `mcp_ads_agent_list_accessible_customers` — confirm which account you're looking at

If the right strategy direction isn't obvious from this data alone, invoke `marketing-brainstorming`
before forming a recommendation.

② **Form a recommendation.** Write a short narrative summary plus a numbered list of concrete
recommendations, each with a rationale grounded in the data you just pulled. (`marketing-writing-plans`
covers this payload shape in more detail if you invoked it above.)

③ **Submit it — never execute it yourself.** Run `verification-before-proposing` first, then call:

```json
mcp_ads_agent_propose_change({
  "kind": "campaign_strategy",
  "campaignId": null,
  "payload": {
    "summary": "<one-paragraph narrative>",
    "recommendations": [
      { "title": "<short title>", "rationale": "<why, citing the data>", "suggestedAction": "<optional concrete next step>" }
    ]
  },
  "triggeredRule": "hermes:campaign_strategy",
  "rationale": "<why now — e.g. what changed in the data>"
})
```

④ **Tell the user what happened.** Report the returned `proposalId` and that a human must approve it
at ads-agent's `/proposals` page before anything changes.

## Pitfalls

- **Never invent Google Ads data.** Every number in your summary must come from a tool call this
  turn — no citing figures from memory or a previous session.
- **Never attempt a write action other than `propose_change`.** You have no other write tool
  available; if a user asks you to "just pause that campaign," explain that you can only propose the
  change for human approval, then call `propose_change` with `kind: "pause"` instead of refusing
  outright.
- **`campaignId` is nullable** — leave it `null` for account-level strategy proposals; only set it
  when a recommendation is scoped to one specific campaign whose id you have from
  `list_campaign_performance`.

## Verification

After calling `propose_change`, confirm the tool returned a `proposalId` (a UUID) — if it returned an
error instead, read the message (invalid `kind`, DB unreachable) and fix the input rather than
retrying blindly.
