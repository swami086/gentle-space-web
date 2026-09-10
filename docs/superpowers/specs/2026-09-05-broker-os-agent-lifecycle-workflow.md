# Broker OS — agent lifecycle & practice workflow

Date: 2026-09-05  
Status: **source of truth for marketing “how it works” + product narrative**  
Related: `2026-09-05-broker-os-marketing-messaging-design.md`

---

## Skills used (catalog)

| Role | Skill |
|------|--------|
| Process | `superpowers:brainstorming`, `using-superpowers` |
| Positioning | `positioning-ideas` |
| Copy | `copywriting`, `humanizer` |
| Jobs | `job-stories` |
| Research | `firecrawl-cli` |
| Design | `figma-use` |

Research sources (firecrawl, 2026-09-05):

- [AI tools by agent workflow (Perspective)](https://getperspective.ai/blog/ai-tools-for-real-estate-the-2026-guide-organized-by-the-agent-workflow) — industry 5-stage map  
- Competitive category note: Lofty markets [AOS](https://lofty.com/aos) as “agentic AI operating system” for US agents — see § Competitive claim  
- Product proof: `ads-agent/` proposals + campaign drafts (approve before spend)

---

## What “AI Operating System” means here

Broker OS is not one chatbot bolted onto a CRM. It is the **desk the practice runs on**: shared data, shared queue, agents that draft work inside that desk, and a human gate on anything that spends money or messages a client.

**Audience language (locked):** Real Estate Consultants — covers independent CRE and residential practitioners (India/global), not only US “agent” MLS culture.

---

## Industry workflow map (what the market already expects)

From Perspective’s 2026 workflow taxonomy (specialized tools per stage — their claim is “don’t buy a mediocre suite”):

| Stage | Bottleneck | Typical tools |
|-------|------------|---------------|
| 1. Lead generation | No top-of-funnel | Paid social, IDX, predictive prospecting |
| 2. Qualify & converse | Thin forms, slow speed-to-lead | Chat/SMS/voice qualify |
| 3. Listing / campaign marketing | Content + ads across platforms | Creative, Ads Managers |
| 4. Transaction & admin | Dropped follow-ups, deadlines | CRM automation |
| 5. Market analysis | Pricing / prospecting data | Analytics, comps |

**Broker OS bet (opposite of “buy 2–4 point tools”):** one OS that wires stages 1→5 so the consultant does not live in twelve tabs — with agents doing grind *inside* the OS, not as a separate product.

---

## Broker OS lifecycle (canonical)

```
Capture demand  →  Enrich who it is  →  Draft campaigns  →  Approve & go live
                                                              ↓
                                              Analytics (what worked / wasted)
                                                              ↓
                                         Enquiries land  →  Follow-up queue  →  Deal work
                                                              ↓
                                         Learn → next campaign / next lead batch
```

### Stage-by-stage (agent + human)

| # | Stage | System does | Consultant does | Gate |
|---|--------|-------------|-----------------|------|
| **01 Capture** | Lead generation | Surfaces inbound (forms, WhatsApp, portals) and paid demand signals; opens lead records | Sets offer / geography / budget intent | — |
| **02 Enrich** | Enrichment | Fills firm, role, property context, history from prior enquiries | Corrects facts that matter for the pitch | — |
| **03 Draft** | Campaigns | Agent drafts Meta / Google / LinkedIn setup (audience, budget, creatives, landing) | Reviews draft in desk | **Approve before spend** |
| **04 Live** | Campaign management | Pushes approved draft live; monitors pacing | Pause / edit via new proposal if needed | Approve budget/creative changes |
| **05 Read** | Analytics | Shows enquiries pulled vs spend that went nowhere | Decides what to kill or scale | — |
| **06 Catch** | Enquiries | Routes replies (WhatsApp, email, form) into one queue | Owns the conversation | Approve outbound templates if automated |
| **07 Close loop** | Follow-ups | Nudges stale threads; prep notes for calls | Closes or advances the deal | — |
| **08 Learn** | Feedback into OS | Ties enquiry outcomes back to campaign + lead source | Sets next intent | — |

### Job stories (JTBD)

1. **When** a listing or mandate needs demand this week, **I want** a campaign drafted from the mandate brief, **so I can** approve spend once and stop rebuilding Ads Manager from scratch.  
2. **When** a WhatsApp enquiry arrives at 11pm, **I want** it enriched and queued with context, **so I can** reply in the morning without hunting tabs.  
3. **When** ads ran last week, **I want** to see which creatives pulled enquiries vs wasted spend, **so I can** approve the next draft with eyes open.

### Proof surface today (`ads-agent/`)

Already real in product trajectory:

- Campaign draft chat → proposal payload  
- `proposals` with `pending` → human `approved` / `rejected`  
- Decision-engine rules that *propose* pause / budget change — never silent spend  
- Analytics tools that list pending proposals  

Marketing must not claim full Stage 01–08 autonomy that is not shipped; it *can* claim the OS shape and the approval gate as product truth.

---

## Competitive claim — “industry’s first”

**User-facing category line (requested):**

> The industry’s first AI Operating System for Real Estate Consultants.

**Internal caveat (do not ignore):** Lofty markets **Lofty AOS** as “the real estate industry’s first agentic AI operating system” aimed at US agents/brokers ([lofty.com/aos](https://lofty.com/aos), HousingWire coverage). Blind “first OS for real estate” is contested.

**How we keep the line honest enough to ship:**

| Angle | Why it still differentiates |
|-------|------------------------------|
| **Consultants** (not MLS agent AOS) | Own ICP: independents running CRE + residential practice |
| **Full commercial loop** | Lead → enrich → **paid campaigns** → analytics → enquiry follow-up |
| **Human-gated spend** | Drafts queue; nothing spends until approve (anti-autopilot) |
| **India / WhatsApp-native desk** | Channels consultants actually use |

If legal/marketing later softens “first,” fallback category:

> An AI Operating System for Real Estate Consultants.

Never name Lofty (or other competitors) on the public page.

---

## Marketing expression (page)

| Surface | Copy spine |
|---------|------------|
| Eyebrow | `THE AI OPERATING SYSTEM FOR REAL ESTATE CONSULTANTS` |
| Category / punch | `The industry’s first AI Operating System for Real Estate Consultants.` |
| Hero headline | Keep concrete: `Everything your practice runs on — in one place.` *or* lead with category line if brand wants category-first |
| How it works | 01 Capture & enrich → 02 Draft & approve campaigns → 03 Catch enquiries & follow up |
| Agents block | Agents draft and nudge inside Broker OS. You approve what spends and what sends. |

---

## Hero product shot (design decision)

v9’s **+8° slanted** teaser read distorted (illegible UI, awkward crop). **v10 fix:** remove rotation. Use a **flat floating product window** with soft shadow + optional low-opacity depth plate behind (no tilt) — Linear-style proof, StackGen *layout* (copy left / product right) without perspective warp.
