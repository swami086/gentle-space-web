# BrokerDesk — full messaging re-validation (Opus5 pass)

Date: 2026-09-05
Status: **research complete — messaging locked at v7**
Product: **BrokerDesk** (placeholder) — SaaS productization of `ads-agent/` as an AI operating desk for independent **CRE + residential** brokers (one message for both)
Method: skills catalog → Semrush MCP (`us`) → Reddit VOC (Composio) → synthesis → copy lock
Supersedes: `2026-09-05-brokerdesk-ai-tools-search-intent.md` (v6), `2026-09-05-brokerdesk-cre-search-intent-alignment.md`, `2026-09-05-brokerdesk-pain-messaging-research.md`

---

## Verdict (read this first)

v6 said: *enter on AI-agent search language, then prove you're not another AI tool.* That holds. Two things were wrong, and one thing was buried in the micro-copy that should be the headline.

1. **Human-gated approval is the wedge, not the disclaimer.** Every upvoted pro-AI comment from working brokers carries the same qualifier — *"absolutely needs a human in the loop"*, *"the second you get overly confident in it… it will fail you"*, *"you still gotta review it"*. The closest thing to BrokerDesk found in the wild is a broker describing his own manual workaround: *"A broker in my office is having it draft automated responses to basic inquiry emails. If he receives an email on a property, it'll draft an email, he reviews it and sends it off."* The locked product decision (broker approves spend) is the single most VOC-validated attribute we have. Promote it into the hero.
2. **CRE is a real acquisition lane, not just proof language.** v6 demoted CRE because `ai for commercial real estate` is 90/mo. True — but `commercial real estate marketing` is 720/mo at **KD 7**, `commercial real estate crm` is 1,000/mo at **KD 25** with a **$25.49 CPC**, and the CRE-CRM SERP is owned by *generic* CRMs (Pipedrive, HubSpot, Salesforce, monday, Act) — Buildout/Apto don't rank top 15. Cheap, high-value, and matched by a verbatim ICP request.
3. **The winnable AI phrasing is agent/assistant, not "AI for".** `ai agents for real estate` = KD **23**; `real estate ai assistant` = KD **22**; `ai for real estate agents` = KD **62**. v6 picked the agent phrasing for product-fit reasons. It is also the cheapest to rank.

**Tone constraint (new, and load-bearing):** the top comment on the biggest CRE AI thread is *"Can we stop all these ads that are posed as questions yet?"* (27 upvotes). Brokers are actively hostile to AI vendor marketing. Copy must not read like an AI vendor ad — no "revolutionize", no rhetorical-question hero, no autonomy bragging.

---

## Phase 0 — Skills locked

| Role | Skill | Source / installs |
|------|-------|-------------------|
| Process | `superpowers:brainstorming` (findings → approaches → recommendation) | `obra/superpowers` — 352.4K |
| Semrush execution | `semrush` (installed) | `~/.agents/skills/semrush` |
| Semrush method | `semrush-research` (installed) | `openclaudia` — 434 |
| Keyword method | `keyword-research` (installed) | `openclaudia` — 424 (catalog peer `aaron-he-zhu` 6.8K) |
| Copy | `copywriting` (installed) | `coreyhaines31/marketingskills` — 193.9K |
| Positioning | `refoundai/lenny-skills@positioning-messaging` | catalog — 2.1K |
| ICP | `phuryn/pm-skills@ideal-customer-profile` | catalog — 2.5K |
| Reddit VOC | `lignertys/reddit-research-skills@reddit-research` | catalog — 4.4K |
| VOC mining | `deanpeters/product-manager-skills@voice-of-customer-miner` | catalog — 415 |

Followed from the installed files: Semrush discovery → `get_report_schema` → `execute_report`, `database=us`, `display_limit` 15–40, no invented metrics; keyword-research intent classification and pillar/cluster structure; copywriting rules (specific over vague, customer language over company language, no exclamation points, benefits over features).

**Rejected:** residential-only proptech and ASO/ecommerce keyword skills (wrong vertical); backlink-audit (not this question).

---

## Phase 1 — AI cluster (Semrush, US, live)

### A. Category and product-match terms

| Keyword | Vol/mo | CPC | KD | Intent | Fit |
|---------|--------|-----|-----|--------|-----|
| ai and real estate | 2,400 | $4.80 | 72 | Informational | Thought-leadership SERP |
| real estate ai | 1,900 | $4.80 | 58 | Informational | Broad |
| ai for real estate | 1,600 | $4.80 | 61 | Informational | Broad |
| ai in real estate | 1,600 | $4.80 | 65 | Informational | Broad |
| ai real estate | 1,300 | $4.80 | 59 | Informational | Broad |
| ai for real estate agents | 880 | $6.91 | **62** | Commercial | ICP-qualified but hard |
| lofty ai | 880 | $3.72 | — | Navigational | Brand competitor |
| ai real estate agent | 720 | $4.65 | 37 | Ambiguous | Replacement-hype risk |
| real estate ai tools | 720 | $9.71 | 43 | Commercial | Tool-list intent |
| **ai agents for real estate** | **480** | **$7.07** | **23** | Commercial | ★ best product + cheapest |
| ai tools for real estate agents | 480 | $7.54 | 31 | Commercial | Tool-list intent |
| ai agent for real estate | 390 | $6.14 | 38 | Commercial | Product match |
| real estate ai agent | 390 | $6.11 | 46 | Commercial | Product match |
| ai for realtors | 320 | $7.64 | — | Commercial | Residential-coded |
| chatgpt for real estate | 260 | $8.74 | — | Informational | DIY competitor |
| real estate ai software | 260 | $8.88 | — | Commercial | Software intent |
| ai tools for real estate | 260 | $8.14 | — | Commercial | Tool-list |
| chatgpt for realtors | 210 | $0 | — | Informational | DIY |
| **real estate ai assistant** | **210** | **$14.11** | **22** | Commercial | ★ cheap + on-product |
| ai for real estate marketing | 170 | $10.71 | — | Commercial | Use case |
| ai real estate lead generation | 170 | $10.92 | — | Commercial | Use case |
| ai real estate assistant | 170 | $9.10 | — | Commercial | Variant |
| best ai for real estate agents | 170 | $7.64 | — | Comparison | Listicle SERP |
| ai crm real estate | 110 | $9.38 | — | Commercial | Niche, on-product |
| ai broker | 110 | $4.10 | — | Ambiguous | Weak |
| ai tools for realtors | 90 | $8.66 | — | Commercial | Small |
| **ai for commercial real estate** | **90** | $9.40 | — | Commercial | CRE AI — tiny |
| ai real estate crm | 70 | $10.44 | — | Commercial | Niche |
| ai for cre | 30 | $7.10 | — | Commercial | Near-zero |
| cre ai | 30 | $6.90 | — | Commercial | Near-zero |

### B. Point tools that own "AI tools" mindshare (not our category)

| Keyword | Vol/mo | CPC |
|---------|--------|-----|
| virtual staging ai | 2,400 | $3.54 |
| real estate chatbot | 390 | $8.74 |
| ai for real estate listings | 210 | $7.26 |
| real estate ai chatbot | 170 | $8.19 |
| ai listing description | 70 | $2.75 |
| ai voice agent real estate | 30 | $0 |

### C. Horizontal "AI does a job" frames — demand exists, but off-ICP

| Keyword | Vol/mo | CPC |
|---------|--------|-----|
| ai receptionist | 5,400 | $14.36 |
| ai crm | 3,600 | $23.95 |
| ai sdr | 2,400 | $26.09 |
| ai sales agent | 2,400 | $16.72 |
| ai marketing automation | 1,900 | $13.60 |
| ai employee | 1,000 | $5.88 |
| ai agents for business | 880 | $19.64 |
| ai powered crm | 880 | $25.47 |
| ai marketing agent | 590 | $9.47 |
| ai appointment setter | 480 | $15.14 |
| ai prospecting | 320 | $16.31 |
| ai lead qualification | 260 | $14.29 |

Read: the "an AI agent that does a named job, and you pay for the job" frame is a proven buying pattern with high CPCs. Use it as **tone and framing evidence**; do not target these terms (wrong buyer).

### D. Trust and fear signals

| Keyword | Vol/mo | CPC | Competition |
|---------|--------|-----|-------------|
| speed to lead | 1,600 | $14.00 | 0.44 |
| **human in the loop ai** | **720** | $6.44 | **0.14** |
| will ai replace real estate agents | 260 | $0 | 0.01 |
| lead response time | 210 | $0 | 0.01 |
| ai lead follow up | 170 | $18.79 | 0.41 |
| real estate ai chatbot | 170 | $8.19 | 0.23 |
| ai cold calling real estate | 50 | $12.90 | 0.57 |
| ai receptionist for real estate | 50 | $12.12 | 0.48 |

Question cluster (`phrase_questions`, seed `ai real estate`) is dominated by **replacement anxiety**, not shopping:

| Question | Vol/mo |
|----------|--------|
| how ai is changing real estate in usa | 1,000 |
| will ai replace real estate agents | 260 |
| which ai is good for real estate | 140 |
| will real estate agents be replaced by ai | 140 |
| can ai replace real estate agents in australia | 110 |
| how to use ai in real estate | 110 |
| will ai take over real estate agents | 90 |

Plus ~15 further replacement-fear variants at 20–50/mo (`is ai going to replace real estate agents`, `can ai be a licensed real estate agent`, `are real estate agents going to be replaced by ai`…). Informational AI demand in this vertical is **anxiety-shaped**. Reassurance is a content lane; "AI that replaces you" is a positioning landmine.

### E. "Broker OS" is dead as search language

| Keyword | Vol/mo |
|---------|--------|
| real estate operating system | 30 |
| brokerage software | 390 |
| real estate brokerage software | 320 |
| real estate automation | 260 |
| real estate automation software | 210 |
| ai assistant for realtors | 20 |
| ai for brokers | 20 |

Confirms the earlier decision to drop "Broker OS" from anything search-facing.

### F. SERP composition — who actually ranks

`ai for real estate agents` (top 20 organic):

| Type | Domains |
|------|---------|
| Listicles / associations | nar.realtor, housecanary.com, housingwire.com, realtrends.com, dotloop.com, v7labs.com |
| Point tools | withjoy.ai, retellai.com (voice), realestatecontent.ai, chatbot.com, voiceflow.com, mindstudio.ai |
| Thought leadership | mckinsey.com ("how agentic AI can reshape real estate's operating model", ranking twice) |
| Dev agency SEO | solguruz.com, sam-solutions.com |
| CRE | adventuresincre.com (tool roundup) |
| Community | reddit.com r/AI_Agents "AI in real estate — what tools are you actually using?" |

`ai agents for real estate` (top 15): same pattern, plus housingwire.com *"world's first AI real estate agent has already made $100M in sales"* and agentx.so.

**Gap confirmed and unchanged:** no product owns *one human-gated AI agent that runs an independent broker's full desk across CRE and residential*. The SERP sells tool piles, dev-shop services, or replacement hype.

---

## Phase 2 — CRE cluster (Semrush, US, live)

### A. High-intent CRE terms

| Keyword | Vol/mo | CPC | KD | Signal |
|---------|--------|-----|-----|--------|
| commercial real estate software | 1,900 | $17.72 | — | Broad; PM-software + LoopNet pollution |
| **commercial real estate crm** | **1,000** | **$25.49** | **25** | ★ core buyer intent, cheap to rank |
| **commercial real estate marketing** | **720** | $5.55 | **7** | ★ easiest real win on the board |
| deal management software | 720 | $40.95 | — | Highest CPC found; Dealpath territory |
| crm for commercial real estate | 590 | $25.49 | — | Same cluster |
| cre software | 480 | $21.67 | — | Short-form category |
| commercial real estate leads | 390 | $8.63 | — | Lead demand |
| best crm for commercial real estate | 260 | $34.26 | — | Comparison intent |
| **cre crm** | **260** | **$30.21** | **24** | ★ abbreviation search, cheap |
| commercial real estate prospecting software | 260 | $15.22 | — | Outreach tools |
| commercial real estate deal management | 170 | $0 | — | Pipeline language |
| commercial real estate lead generation | 170 | $9.86 | — | Smaller than residential |
| commercial real estate email marketing | 140 | $12.47 | — | Channel-specific |
| commercial real estate marketing software | 110 | $0 | — | On-product |
| commercial real estate prospecting | 70 | $8.24 | — | Method, not product |
| commercial broker software | 70 | $0 | — | Tiny, on-ICP |

### B. Residential comparison (for the same-message decision)

| Keyword | Vol/mo | CPC |
|---------|--------|-----|
| follow up boss | 33,100 | $5.39 |
| zillow premier agent | 12,100 | $14.03 |
| real estate crm | 4,400 | $13.55 |
| real estate lead generation | 2,900 | $19.40 |
| best crm for real estate | 1,900 | $18.94 |
| real estate marketing agency | 1,600 | $7.92 |
| buy real estate leads | 880 | $24.82 |
| real estate marketing automation | 480 | $14.52 |
| real estate lead follow up | 170 | $0 |

Residential volume is 3–10× CRE, but CPC parity is close and CRE difficulty is far lower. **Same message, CRE-cheaper acquisition** is coherent — the locked "one message for both" decision survives the data.

### C. CRE-CRM SERP — the incumbents aren't there

`commercial real estate crm` top 15 organic:

| Type | Domains |
|------|---------|
| **Generic horizontal CRMs** | pipedrive.com, hubspot.com, salesforce.com, monday.com, act.com |
| Listicles / review | nimble.com, credaily.com, sharplaunch.com, forbes.com, blog.thebrokerlist.com, pandadoc.com |
| Adjacent tools | 4degrees.ai, ihomefinder.com, dealpath.com |
| Community | reddit.com r/CRM "looking for a CRM specifically for a commercial…" |

Buildout / Apto — the actual CRE CRM incumbents — **do not appear in the top 15.** A CRE broker searching for a CRE CRM is served generic software and listicles.

`domain_organic` on **buildout.com** (top keywords by traffic) confirms why: their organic footprint is brand navigation (`buildout` 2,900 at #1, `buildout login` 390), individual listing pages (`jericho plaza`, `roswell mall`, `alico road`), and one strong blog asset (`how to find who owns a property` 6,600 at #7; `who owns this house` 1,300 at #3). Category presence is thin — `cre software` #2, `commercial real estate marketing` #3, `apto crm` #1 (140). **Zero AI-term presence.**

### D. Pollution warning (re-confirmed)

`phrase_related` on `commercial real estate crm` returns almost entirely **residential** CRM phrases: `real estate crm` 4,400 (KD 60), `crm for real estate` 2,400, `real estate crm software` 2,400 (KD 37), `best crm for real estate` 1,900 (KD 45), `realtor crm` 1,300, `best crm for realtors` 1,000, `real estate broker crm` 880. Do not treat Semrush "related" output as CRE broker language without filtering for broker vs. property-manager vs. investor vs. residential agent.

---

## Phase 3 — Reddit VOC (Composio, live)

Threads pulled this pass (new since v6 unless noted):

| Thread | Sub | Comments | Why it matters |
|--------|-----|----------|----------------|
| [Is anyone actually using AI in real estate yet or is it all just hype?](https://www.reddit.com/r/CommercialRealEstate/comments/1oui48f/is_anyone_actually_using_ai_in_real_estate_yet_or/) | r/CommercialRealEstate | 152 | The definitive CRE AI sentiment thread |
| [Are CRMs worth it for commercial real estate firms?](https://www.reddit.com/r/CommercialRealEstate/comments/1rbvubg/are_crms_worth_it_for_commercial_real_estate_firms/) | r/CommercialRealEstate | 43 | CRM adoption failure modes |
| [The next big real estate company probably won't look like Zillow at all](https://www.reddit.com/r/RealEstateTechnology/comments/1ssmotk/the_next_big_real_estate_company_probably_wont/) | r/RealEstateTechnology | 146 | "proptech is solving the wrong problem" |
| [Anyone actually using OpenClaw for real estate workflows?](https://www.reddit.com/r/RealEstateTechnology/comments/1s55fq2/anyone_actually_using_openclaw_for_real_estate/) | r/RealEstateTechnology | 139 | Brokers experimenting with agent frameworks |
| [Commercial brokers: what CRM software do you use…](https://www.reddit.com/r/CommercialRealEstate/comments/1v94x1l/commercial_brokers_what_crm_software_do_you_use/) | r/CommercialRealEstate | 53 | Carried from v5 (CRM rot, LoopNet) |

### Verbatim — trust and human-in-the-loop

- *"It is very much being used and has many use cases, but absolutely needs a human in the loop imo"*
- *"The second you get overly confident in it, and think you can just [let] it go — it will fail you."* (founder of an AI asset-management company)
- *"Yeah, you still gotta review it, because Things Happen"*
- *"either people are saving a bunch of time and just rolling the dice assuming that it's correct (which is a terrible idea), or they are fact checking it, which takes a lot of time"*
- *"I think automation is better than AI for many use cases."*
- *"if you are using AI, when someone is on the phone actually engaging — it NEEDS to live transfer to a human"* (agency running 200,000+ calls/quarter)
- *"The hype is around 'full automation.' The reality is that AI is best at clearing the noise so [people] can focus on things that actually move the needle."*

### Verbatim — the product, described by a broker

- *"A broker in my office is having it draft automated responses to basic inquiry emails. If he receives an email on a property, it'll draft an email, he reviews it and sends it off."*

That is BrokerDesk's enquiry loop, hand-rolled, by someone who does not know we exist.

### Verbatim — category is open

- *"I have looked at a bunch of AI CRE applications and nothing is really there yet."*
- *"if you don't adopt it, you'll be left behind by those that have, however, I'm not quite sure we're fully 'There' yet in CRE"*
- *"Where I've seen the biggest change is when teams use tools built specifically for CRE rather than generic chatgpt prompts."*
- *"Why don't we have the Uber of real-estate yet?"*

### Verbatim — CRM failure modes

- *"CRMs can be worth it… if you actually use it to track deals and follow-ups, otherwise it just sits there and feels like extra work."*
- *"You can't force work flow. CRMs always face huge hurdles being implemented across an organization for this reason (unless you tie it somehow to getting the commission check)."*
- *"Anyone have a good crm/program built specifically for a commercial leasing broker/agent? … something ready to go that understands my business inside and out… without all the generic stuff."*
- *"SO many things get lost, forgotten, emails are in account of one person, then they go to another team member… and the property records are lost along the way and nobody knows where exactly to search for them"*
- *"even a lightweight CRM is better than scattered inboxes and spreadsheets"*
- Carried from v5: *"most brokers pick a solid crm and still let it rot because entry stays manual"*, *"scattered across notes, spreadsheets, contacts, emails, and LoopNet leads"*, *"Less than 50% of my Loopnet leads are legit"*, *"Deals go to LoopNet to die"*

### Verbatim — tone constraint

- *"Can we stop all these ads that are posed as questions yet?"* — **top comment, 27 upvotes**
- *"Fun fact, wherever you hear the word 'revolutionize' be sure that the text was generated by An AI model!!"*
- *"bot account. good thing[s] the mods are actually modding. Oh wait"*

Brokers pattern-match AI marketing and punish it. Rhetorical-question heroes, "revolutionize", and autonomy bragging all read as vendor spam to this audience.

---

## Phase 4 — Synthesis

### What changed vs v6

| v6 position | Opus5 finding | v7 action |
|-------------|---------------|-----------|
| Human-gated spend = micro-copy reassurance | Most-endorsed VOC attribute in the entire corpus | **Promote to headline** |
| "Not another AI tool" = primary differentiator | Still true, now backed by *"nothing is really there yet"* | Keep, demote to line 2 |
| CRE = proof language only | CRE CRM KD 25 / marketing KD 7; incumbents absent from SERP | **Upgrade to second acquisition lane** |
| `ai for real estate agents` as lead term | KD 62 — expensive | Swap to `ai agents for real estate` (KD 23) |
| Fear cluster = one FAQ line | ~20 replacement-anxiety queries; 1,000/mo "how AI is changing real estate" | Own it as a content lane |
| Confident vision voice | Audience punishes vendor voice | **Plain, evidence-first tone; no rhetorical questions** |

### Approaches considered

**Approach 1 — Agent-category hero (v6 continued).** Lead `The AI agent for your whole broker desk — not another AI tool.` Enters on search language, fights the listicle SERP. *Weakness:* opens on a claim about us, in a market that just told us it distrusts AI claims. The differentiation is against other vendors, not for the broker.

**Approach 2 — Trust-gated agent hero (recommended).** Lead with the agent category *and* the approval gate in one breath. Anti-tool-pile drops to the sub. *Strength:* the only headline where the hero claim is the thing brokers said they want, in the phrasing they used; it also pre-answers the largest informational cluster (replacement fear) above the fold. *Weakness:* slightly longer headline; "approve" is a mild-sounding verb next to "AI agent".

**Approach 3 — Anti-generic CRE hero.** Lead `Built for a commercial leasing broker. Not a generic CRM with a real-estate skin.` Maps to the cheapest keywords (KD 7–25) and a verbatim ICP request. *Strength:* highest search efficiency, sharpest CRE recognition. *Weakness:* breaks the locked "same message for CRE + residential", and positions us as a CRM — the category we explicitly are not.

**Recommendation: Approach 2**, with Approach 3 preserved as a post-waitlist `/cre` page targeting `commercial real estate crm` / `cre crm` / `commercial real estate marketing`.

---

## Messaging house (v7 — locked)

### Category line (search-native)

> The AI agent for independent real estate brokers.

### Differentiation (vs the AI-tools SERP)

> Not another AI tool. One agent that runs your desk — and asks before it acts.

### Trust line (the wedge)

> The agent does the work. You approve it before it ships.

### Pain → promise

> Portal noise, expensive ads, and CRMs that rot because entry stays manual. BrokerDesk is the AI agent that runs demand, follow-up, and pipeline — commercial and residential — and puts every spend and every reply in front of you first.

### One-liner

> BrokerDesk is the AI agent for independent CRE and residential brokers — it runs your marketing, catches every enquiry, and keeps deals moving, with nothing sent or spent until you approve it.

### Punch

> The agent runs the desk. You decide and close.

### Headline options

| ID | Headline | Rationale |
|----|----------|-----------|
| **H1 ★** | `An AI agent for your whole desk. Nothing goes out until you approve it.` | Enters on `ai agents for real estate` (KD 23), differentiates on scope ("whole desk") vs. the point-tool SERP, and leads with the single most-endorsed VOC attribute. Pre-empts replacement fear above the fold without arguing about it. |
| **H2** | `Not another AI tool. One agent that runs your desk — you approve every move.` | Anti-listicle first. Sharper against the SERP, weaker as a statement of what we do. Best ad variant. |
| **H3** | `The AI agent for brokers who don't trust AI yet.` | Mirrors *"I'm very AI skeptical but have used it a bit at work."* Highest scroll-stop, highest risk — foregrounds doubt and could read as clever-for-its-own-sake to a warm visitor. |

**Recommended: H1.**

### Recommended waitlist copy (locked)

- **Eyebrow:** `AI AGENT · CRE & RESIDENTIAL`
- **Headline:** `An AI agent for your whole desk. Nothing goes out until you approve it.`
- **Sub:** `Staging apps, chatbots, and ChatGPT tabs don't run a practice. BrokerDesk runs your marketing, catches every enquiry, and keeps follow-up moving — commercial and residential — and drafts every spend and every reply for your review before it ships.`
- **CTA:** `Join waitlist`
- **Micro:** `Human in command. Built for independent brokers — not franchises, not AI that replaces you.`

Shorter sub (if the hero runs long):

> One AI agent for marketing, enquiries, and deal follow-through — CRE and residential. It drafts. You approve. Nothing ships without you.

### PAS

- **Problem:** You're stacking AI tools and still losing enquiries in WhatsApp and a CRM you never update.
- **Agitate:** Staging AI, ChatGPT, and chatbots don't run campaigns, catch inbounds, or stop CRM rot. And the AI that claims to do it all won't show you what it's about to send or spend.
- **Solution:** One agent for the desk — demand, capture, follow-through — drafting everything, shipping nothing until you say go.

### Outcomes strip

1. **One agent, not twelve tools**
2. **Nothing spends without your nod**
3. **Every enquiry caught**
4. **A CRM that stays current without retyping**

### FAQ (objection language taken from VOC)

1. **Is this another AI writing / staging tool?** No. Those are point tools. This agent runs marketing, enquiries, and pipeline.
2. **Will AI replace me?** No. You approve spend and you close. The agent owns the grind.
3. **What if the AI gets it wrong?** You see the draft before it sends and the spend before it runs. Nothing goes out unreviewed.
4. **I already use ChatGPT.** ChatGPT is a tab. This is the desk.
5. **I already have a CRM.** CRMs rot when entry stays manual. The agent keeps the desk current so the CRM stays useful.
6. **CRE and residential?** Same agent. Same message.

### Honest non-claims

Not virtual staging. Not owner/property data (Reonomy). Not a listing marketplace (LoopNet/CoStar). Not an institutional deal desk (Dealpath). Not autonomous spend. Not "AI that replaces the broker."

---

## Post-waitlist SEO plan (priority order by KD × value)

| Priority | Target | Vol | KD | CPC | Page |
|----------|--------|-----|-----|-----|------|
| 1 | commercial real estate marketing | 720 | **7** | $5.55 | `/cre-marketing` — CRE demand gen, human-gated |
| 2 | ai agents for real estate | 480 | **23** | $7.07 | Category page — "one agent vs. tool pile" |
| 3 | cre crm | 260 | **24** | $30.21 | `/cre` — anti-generic-CRM (Approach 3 copy) |
| 4 | commercial real estate crm | 1,000 | **25** | $25.49 | `/cre` — same page, primary term |
| 5 | real estate ai assistant | 210 | **22** | $14.11 | Assistant-frame landing |
| 6 | ai tools for real estate agents | 480 | **31** | $7.54 | Comparison / "not a tool list" |
| 7 | ai agent for real estate | 390 | **38** | $6.14 | Category support |
| — | Fear cluster (`will ai replace real estate agents` 260 + ~15 variants; `how ai is changing real estate in usa` 1,000) | — | low | $0 | Reassurance content — cheap traffic, on-message |
| Avoid | ai for real estate agents | 880 | 62 | — | Too hard for a new domain |
| Avoid | ai for commercial real estate / ai for cre / cre ai | 30–90 | — | — | No volume |
| Avoid | real estate operating system | 30 | — | — | "Broker OS" is dead |

---

## Spec self-review

- [x] Skills catalog run first; installed skill files loaded and followed
- [x] All volumes, CPCs, KDs from live Semrush MCP (`us`); none invented
- [x] SERP composition documented for both clusters (`phrase_organic`)
- [x] Competitor organic language pulled (`domain_organic` buildout.com)
- [x] Residential/PM/LoopNet pollution filtered and flagged
- [x] Fresh Reddit VOC with links and verbatim quotes; no fabricated quotes
- [x] 3 approaches with a single recommendation
- [x] 3 headline options with a ★ pick
- [x] CRE + residential same message preserved
- [x] Human-in-command promoted from caveat to wedge
- [ ] Waitlist Figma rewrite with v7 copy
- [ ] `/cre` page build (Approach 3 copy, post-waitlist)
