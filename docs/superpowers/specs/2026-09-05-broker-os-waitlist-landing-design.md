# Broker OS waitlist landing page — design

Date: 2026-09-05  
Status: approved direction; Figma `3:4` updated with **v7 Opus5** copy (2026-09-05) — product name placeholder `BrokerDesk`  
Related: `2026-09-05-brokerdesk-outcome-messaging.md` (v7), `2026-09-05-brokerdesk-opus5-ai-messaging-research.md`, PRODUCT.md  
Figma: [Waitlist / Desktop](https://www.figma.com/design/bZ7LkDipySdYsNGH0YBtGu/Untitled?node-id=3-4) (`3:4`)

## Goal

Ship a **YC-style pre-product waitlist page** for **BrokerDesk** — the AI agent for independent brokers’ end-to-end desk (CRE **and** residential). Primary audience: **independent brokers / small brokerages, global**.

This page is **not** a redesign of the live Gentle Space CRE marketing homepage. It is a separate acquisition surface for the SaaS productization of the ads-agent / broker admin stack.

## Decisions locked

| Decision | Choice |
|----------|--------|
| Page type | Pre-product waitlist (B) |
| Product | AI broker agent / operating desk — end-to-end workflow |
| Audience | Independent CRE **and** residential brokers, **global**, same messaging |
| Layout | Mercury pattern (Option 1): centered hero + inline email + one product screenshot |
| Theme | **Dark mode** (user override on Option 1) |
| Primary CTA | Join waitlist (email) — not Sign up / Start free trial |
| Messaging posture | **v7:** AI-agent category entry + **human approval as hero wedge**; ads-agent screenshot = proof |

## Non-goals

- Redesigning `app/page.tsx` Gentle Space CRE consultancy site
- Full marketing site (pricing, blog, multi-nav mega menus)
- Live product auth / trial signup on this page
- Building the page in this spec (implementation follows approval + plan)
- Inventing testimonials or press logos we do not have

## Positioning (copy — locked v7)

Source: `2026-09-05-brokerdesk-outcome-messaging.md` + Opus5 research

**One-liner:**  
> BrokerDesk is the AI agent for independent CRE and residential brokers — it runs your marketing, catches every enquiry, and keeps deals moving, with nothing sent or spent until you approve it.

**On-canvas waitlist copy (Figma `3:4`):**

| Element | Copy |
|---------|------|
| Eyebrow | `AI AGENT · CRE & RESIDENTIAL` |
| Headline | `An AI agent for your whole desk. Nothing goes out until you approve it.` |
| Subcopy | `Staging apps, chatbots, and ChatGPT tabs don’t run a practice. BrokerDesk runs your marketing, catches every enquiry, and keeps follow-up moving — commercial and residential — and drafts every spend and every reply for your review before it ships.` |
| CTA | `Join waitlist` |
| Microcopy | `Human in command. Built for independent brokers — not franchises, not AI that replaces you.` |

Alt headlines (A/B later):

1. `Not another AI tool. One agent that runs your desk — you approve every move.`  
2. `The AI agent for brokers who don’t trust AI yet.`  
3. `Stop collecting AI tools. Run one agent.`

Promise above the fold; product screenshot below is the **proof layer** (Today / enquiries desk), not a feature laundry list.

## Page flow (inspired by [Rote](https://tryrote.com/))

Rote’s conversion rhythm (adapted — not cloned). Keep **BrokerDesk dark** + vision messaging; borrow **structure and human-gated agent framing**.

| # | Rote pattern | BrokerDesk adaptation |
|---|--------------|------------------------|
| 0 | Minimal nav + primary CTA | Wordmark · How it works · Outcomes · FAQ · **Join waitlist** |
| 1 | Hero: visceral outcome + “You X. You Y.” + **live product UI** | Vision headline + punch **“The agent runs the desk. You decide and close.”** + OS mock |
| 2 | Outcomes strip (“More money / less time”) | Outcome tiles (close more, time back, never lose leads, CRE+resi) — **no invented $ metrics** |
| 3 | How it works: 3 steps, “your effort” | **01 Attract** → **02 Agent runs desk** → **03 You close** |
| 4 | Interactive “pick a denial” demo | **Pick a broker job** scenarios (hot lead / campaign / stuck deal) + sample agent output |
| 5 | Agent vs you checklist | What the agent handles vs what stays with the broker |
| 6 | ROI calculator | Optional later; v1 skip or soft “what tool chaos costs” without fake numbers |
| 7 | FAQ (trust / liability) | Autonomy, CRE+resi, CRM objection, spend control |
| 8 | Final CTA | Join waitlist again |

**Rote principle we keep:** human-in-command (“nothing ships until you approve”) + agent owns the grind.  
**Rote principle we don’t copy:** light theme, collision-shop domain, Book-a-demo as only CTA, invented recovery dollars.

## Layout (Mercury hero + Rote scroll)

Above the fold:

1. **Minimal chrome** — wordmark; anchor links; Join waitlist.
2. **Centered hero** — eyebrow, headline, sub with Rote-style punch line, waitlist form.
3. **One product screenshot** — Today desk (proof layer).

Below the fold (Rote-inspired):

4. Outcomes strip (4 tiles max).
5. How it works (3 steps).
6. Scenario picker + sample agent reply (static mock).
7. Agent / You capability list.
8. FAQ (5–6 items).
9. Closing waitlist CTA + footer.

**Do not** add: pricing table, purple gradients, stock office photos, fake testimonials.

## Visual language (dark mode)

| Token | Direction |
|-------|-----------|
| Canvas | Near-black / charcoal (`~#0A0A0B`–`#111`), not pure OLED black if screenshot needs depth |
| Text | Off-white primary; muted gray secondary |
| Accent | One restrained accent (brand CRE accent or soft warm highlight) — **not** purple-on-dark SaaS default |
| Screenshot frame | Soft border or subtle elevated panel; optional faint radial glow behind mock (Laravel Cloud–style restraint, not neon) |
| Type | Expressive sans (not Inter/Roboto/Arial). Avoid generic Inter + slate |
| Motion | Subtle: hero fade/rise + slight screenshot parallax or opacity on load. Max 2–3 motions. No endless loops |

Mobbin references (structure + dark precedents):

- Structure: [Mercury](https://mobbin.com/screens/621240c8-4025-480f-a37a-c881d47f624f) (email + product shot)
- Dark product-teaser: [Laravel Cloud](https://mobbin.com/screens/bb369cb4-f7e0-4c16-a0f3-f39e7e4a3adf), [Spline waitlist](https://mobbin.com/sites/sections/971a7cc7-afe6-4d4c-b4bf-4e1873300a74)
- Waitlist CTA patterns: [Whop waitlist flow](https://mobbin.com/flows/09921d5d-a18c-4fee-8de5-eb9ad89b468c), [Base](https://mobbin.com/sites/sections/75fb9e38-9f05-494f-92ab-86ff2a2e5efd)
- Screenshot content inspiration (CRM/desk): [Apollo](https://mobbin.com/screens/f529b1c6-55b7-422f-8386-995815296ce8), [Clay](https://mobbin.com/screens/f5550b11-f790-4fc9-bd5f-ed8cf53b2acd), [HoneyBook](https://mobbin.com/screens/3c024208-0821-4913-9c43-6e2035fc0ca0)

## Waitlist behavior

1. Submit email → validate → store (provider TBD at plan time: e.g. Resend audience, Postmark, or existing leads path — **do not invent**).
2. Success state on-page: “You're on the list” + optional “We'll email when a seat opens.”
3. No multi-step qualify form in v1 (no company size / title). Can add later if spam or low broker quality.
4. Privacy link required near the form.

## Skills to use at implementation (already shortlisted)

| Skill | Use |
|-------|-----|
| `brainstorming` | Done — this doc |
| `landing` / `design-taste-frontend` / `minimalist-ui` | Visual + anti-slop build |
| `copywriting` | Finalize headline/sub/CTA |
| Mobbin MCP | Re-check screenshot composition if needed |
| `writing-plans` | After this spec is approved |

## Success criteria

- A broker landing cold understands the product in **≤5 seconds**
- Single primary action: join waitlist
- Page feels **dark, calm, product-led** — not a full marketing site or India-only CRE brochure
- Screenshot reads as a broker desk (inbox / today / proposals), not a generic analytics chart

## Open questions (non-blocking for layout; resolve in plan)

1. Product **name** on this page (Gentle Space CRE vs new SaaS brand)?
2. Host path (`/waitlist`, subdomain, or separate deploy)?
3. Email capture backend?
4. Exact screenshot source (live ads-agent capture vs Pencil frame)?

## Spec self-review

- [x] No “TBD placeholder” for locked layout/theme decisions
- [x] Scope limited to waitlist page (not homepage redesign)
- [x] Dark mode called out explicitly
- [x] YC waitlist norms reflected (one sentence, one CTA, show product)
- [ ] User approval of this file required before `writing-plans` / implementation
