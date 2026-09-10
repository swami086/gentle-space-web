# BrokerDesk — landing flow + messaging research

Date: 2026-09-05  
Status: **research complete — awaiting flow choice before Figma rebuild**  
Sources: skills.sh catalog, Mobbin MCP, [Rote](https://tryrote.com/), Greptile, peer AI-agent landings  
Related: `2026-09-05-brokerdesk-outcome-messaging.md`, `2026-09-05-broker-os-waitlist-landing-design.md`

---

## Step 0 — Skills locked (catalog + installed)

| Role | Skill | Source | Why |
|------|--------|--------|-----|
| Process gate | `brainstorming` | Superpowers | Approaches → approve before Figma/code |
| Conversion copy | `coreyhaines31/marketingskills@copywriting` (194K) + local | Catalog + installed | Hero / CTA / section copy |
| PMM / positioning | `marketing-strategy-pmm` + `positioning-ideas` | Installed | Dunford, ICP, category |
| Voice / de-AI | `humanizer` + `copywriting-tone-of-voice` (catalog 2.3K) | Installed + catalog | Tone, tenor, anti-slop language |
| Value props | `phuryn/pm-skills@value-proposition` (2.6K) | Catalog (pattern) | Outcome statements |
| Landing structure | `landing` / `design-taste-frontend` / `minimalist-ui` | Installed | Visual restraint |
| Flow inspiration | Mobbin MCP (`search_screens` / `sections` / `flows`) | MCP | Real SaaS patterns |
| Web tone samples | Firecrawl CLI | Plugin | Rote + peer copy |

Optional later (not blocking): `landing-page-conversion-audit` (41K), `waitlist` skills, `brand-voice`.

---

## Step 1 — How strong product marketers sell AI agents (patterns)

From Rote, Greptile, Mercury, Lightdash, Clay, Stack AI, Gorgias, Notion Agents, Superhuman-style waitlists:

### Tone & tenor (what “good” sounds like)

| Pattern | Example language | Avoid |
|---------|------------------|--------|
| **Visceral outcome, not category** | Rote: “Never argue with an adjuster again.” Greptile: “The AI Code Reviewer.” | “AI-powered proptech platform” |
| **Human effort in two beats** | Rote: “You forward the email. You tap approve.” | Long feature paragraphs in the hero |
| **Agent does grind; you keep judgment** | Lightdash: “You review and approve, but you don’t do the grunt work.” | “Fully autonomous / set and forget” without control |
| **Specific over vague** | “Fill the gaps in your test coverage.” / “Powerful banking. Simplified finances.” | “Streamline your workflow” |
| **Calm confidence** | Short sentences. Active verbs. No exclamation marks. | Hype, “seamless,” “elevate,” “magical” (unless brand is consumer-playful) |
| **Trust FAQ before final CTA** | Rote FAQ: who sends? legal? relationships? | Ignoring autonomy / liability fears |

### Product marketing moves that convert

1. **Category of one job** — name the job (“AI code reviewer,” “supplement recovery agent”), not the stack.  
2. **Show the product working in-hero** — live UI / interactive demo > abstract art (Rote, Mercury, Stack AI).  
3. **Effort labels** — “Your effort: ~30 seconds / one tap” (Rote) makes AI feel safe.  
4. **Scenario picker** — “Pick a denial…” (Rote) / pick a broker job — proves the agent without a sales call.  
5. **Agent vs You matrix** — who does what (Rote Fully handled list; Lightdash Agents act / Humans supervise).  
6. **Outcomes strip** — money/time/miss-nothing (Rote); skip invented $ for waitlist unless labeled illustrative.  
7. **Single primary CTA** — waitlist or demo; don’t compete Join + Book + Start free in the hero.

### Voice for BrokerDesk (recommended)

**Tenor:** Quietly powerful — like Mercury + Rote, not Chatbase “magical.”  
**Register:** Broker-owner vernacular (deals, enquiries, follow-up, Ads Manager, WhatsApp) — not enterprise IT jargon.  
**Stance:** Visionary on the job; concrete on control (“you approve / you close”).  
**Humanizer pass:** Kill seamless/elevate/unlock/leverage/revolutionize; prefer “runs,” “captures,” “closes,” “approves.”

---

## Step 2 — Mobbin flow inspiration (better / similar to Rote)

### Tier A — closest to our job (recommended borrow)

| Ref | Link | Steal this |
|-----|------|------------|
| **Mercury** | [Hero + product shot](https://mobbin.com/screens/621240c8-4025-480f-a37a-c881d47f624f) | Centered outcome headline + email CTA + honest desk screenshot. Already our base. |
| **Rote** (live, not Mobbin) | [tryrote.com](https://tryrote.com/) | Full scroll: hero UI → outcomes → how it works (effort) → scenario demo → agent checklist → FAQ → CTA |
| **Lightdash** | [Agentic BI how it works](https://mobbin.com/sites/sections/91a938cc-45fe-44a6-b377-2a52b0f44b7d) | **Agents act / Humans supervise / Users explore** — perfect human-gated frame |
| **Clay** | [How it works 4 cards](https://mobbin.com/sites/sections/28c16d19-1b1c-4c38-b06e-660c77901cbc) | Describe → context → test → deploy — plain-language agent setup |
| **Browserbase** | [Zero setup 3 steps](https://mobbin.com/sites/sections/687d0833-191b-4fba-8963-368492c97a10) | Numbered visual steps ending in a concrete task |

### Tier B — waitlist / early-access tone

| Ref | Link | Steal this |
|-----|------|------------|
| **Greptile / TREX** | [Early access hero](https://mobbin.com/sites/sections/a147278a-6356-4444-bdd6-cc8ff3866b31) | Outcome verb headline + work email + “get early access” |
| **Retool** | [Join waitlist card](https://mobbin.com/sites/sections/cf57e12d-e9f3-43a8-a5ea-ae3f50cd77b9) | Dual path: waitlist + watch teaser |
| **Contra** | [Join Waitlist dark](https://mobbin.com/sites/sections/2e521a53-0338-4afe-a4a6-086e71cb7ab4) | Dark, one CTA, outcome headline |
| **Whop** | [Waitlist](https://mobbin.com/screens/38746fe2-c4da-4e72-9764-a662be516372) | Minimal join-list pattern |

### Tier C — agent category language (tone only)

| Ref | Link | Steal this |
|-----|------|------------|
| **Stack AI** | [From process to AI agent](https://mobbin.com/screens/e1764749-a680-4eac-8562-8dc4a9d93895) | “Process → agent” framing |
| **Notion Agents** | [Meet the night shift](https://mobbin.com/screens/51cae267-6b32-4e06-b59e-302028fb9ce1) | Metaphor headline; agent works while you don’t |
| **Gorgias** | [Built for X badge](https://mobbin.com/screens/11ce8b13-f136-4553-979e-695b5dded431) | Niche badge + dual outcome headline |
| **Amplemarket** | [4 simple steps](https://mobbin.com/sites/sections/4e223022-ab0c-43a3-bbac-f18890832dc1) | Dark numbered steps for AI outreach agent |

**Verdict vs Rote alone:** Rote remains the best **full narrative scroll** for human-gated agents. Mercury remains the best **above-the-fold waitlist**. Lightdash/Clay are **better how-it-works** than copying Rote’s collision-shop UI. Combine: Mercury hero + Rote scroll logic + Lightdash “humans supervise.”

---

## Step 3 — Refined messaging (v4 draft)

### Category
> The AI agent for independent brokers.

### Punch line (Rote-style two beats)
> The agent runs the desk. You decide and close.

### Hero options (pick one primary)

| # | Headline | Best when |
|---|----------|-----------|
| **H1** | `Stop losing deals to tool chaos.` | Pain-led (Rote energy) |
| **H2** | `Your AI agent for the entire broker workflow.` | Vision / category (current) |
| **H3** | `Close more. Operate less.` | Outcome pair (Mercury brevity) |

**Recommendation:** **H1** for waitlist conversion; keep H2 as eyebrow/category support.

### Recommended hero block

- **Eyebrow:** `AI AGENT · CRE & RESIDENTIAL`  
- **Headline:** `Stop losing deals to tool chaos.`  
- **Sub:** `One agent attracts demand, captures every enquiry, and keeps deals moving — commercial and residential. The agent runs the desk. You decide and close.`  
- **CTA:** `Join waitlist`  
- **Micro:** `No spam. Built for independents — not franchise suites.`

### Outcomes strip (no fake $)

1. **Close more** — Leads don’t die between ads, WhatsApp, and CRM  
2. **Get time back** — Campaign ops and triage off your plate  
3. **Miss nothing** — Every inbound in one spine  
4. **Stay in command** — You approve spend and client-facing moves  

### How it works (Lightdash + Rote)

**Section title:** `Your job: decide and close`  
**Sub:** `The agent does the research, drafting, and follow-through. Nothing material goes out until you say so.`

| Step | Title | Body | Your effort |
|------|-------|------|-------------|
| 01 | Connect your practice | Campaigns, inbound channels, CRM — one desk | Setup once |
| 02 | Agent runs the grind | Demand, enquiries, prep, proposals, reminders | Glance + approve |
| 03 | You take the close | Tours, negotiation, trust — judgment stays human | The work that matters |

### Scenario picker (Rote “pick a denial”)

**Title:** `Pick a broker job from this week`  
Scenarios: Hot WhatsApp lead · Campaign needs a rethink · Deal stuck in follow-up  
Show sample agent output + “Approve” affordance (static mock).

### Agent / You

| Agent | You |
|-------|-----|
| Draft & optimize campaigns | Approve spend |
| Capture & triage enquiries | Choose who to call |
| Call prep & reminders | Run the meeting |
| Keep CRM / Today current | Close the deal |

### FAQ (trust)

1. Does the AI spend my ad budget without me? → No — approve before money moves.  
2. Is this another CRM? → CRM stores people; this agent runs the practice.  
3. CRE and residential? → Same agent, same desk.  
4. What do I still do? → Decide and close.  
5. When do I get access? → Waitlist / early seats.

### Final CTA
> Get early access. Bring the chaos you want the agent to run.

---

## Step 4 — Three page-flow approaches

### Approach A — Mercury + light Rote (minimal)
Hero (waitlist + screenshot) → 3 outcomes → 3 how-it-works → footer CTA  
**Pros:** Fast to ship, YC-clean. **Cons:** Less proof of “agent.”

### Approach B — Rote-inspired full scroll (**recommended**)
Hero (punch + waitlist + live desk UI) → outcomes strip → how it works (effort) → scenario picker → Agent/You → FAQ → closing waitlist  
**Pros:** Best match to Rote conversion + Mobbin Lightdash/Clay patterns; sells vision with control. **Cons:** Longer Figma/build.

### Approach C — Product-demo led (Stack AI / Chatbase)
Hero split: copy left + interactive agent panel right → logo/trust → deep features  
**Pros:** Immediate “try” feel. **Cons:** Needs real interactive demo; heavier than waitlist stage.

**Recommendation: Approach B** — dark Mercury hero we already have, expanded with Rote scroll + Lightdash human-supervise language. Primary CTA stays **Join waitlist** (not Book demo) until sales motion exists.

---

## Spec self-review

- [x] Catalog skills gathered first  
- [x] Mobbin comps cited with URLs  
- [x] Tone/tenor extracted from live peers  
- [x] Messaging refined (v4 draft)  
- [x] 3 approaches + recommendation  
- [ ] User picks approach + hero (H1/H2/H3) before Figma rebuild  
