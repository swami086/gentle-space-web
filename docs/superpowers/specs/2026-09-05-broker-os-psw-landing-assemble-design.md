# Broker OS — PSW landing assemble (Marketing `28:2`)

Date: 2026-09-05  
Status: **shipped — assembled + full-page PMM chrome on Marketing `28:2` (2026-09-05)**  
Figma: `bZ7LkDipySdYsNGH0YBtGu` · page `BrokerDesk Waitlist` · frame `28:2`  
Assets: board `143:2` (P1–P4 `143:3–6`, S1 `143:7`, H1–H3 `143:8–10`)  
Related: `2026-09-05-broker-os-problem-solution-how-it-works.md`, chaos-cards-v2 design

## Locked decisions (brainstorm)

| # | Decision |
|---|----------|
| Surface | Extend Figma **`Broker OS / Marketing` (`28:2`)** — not waitlist `3:4`, not code-first |
| Mid-page | Replace **The suite** (`29:2`) + current **How it works** (`29:26`) with PSW |
| Keep | Nav, Hero, Platform logos, **Product proof**, Agents inside, Closing CTA |
| Product proof vs S1 | Keep Product proof; Solution uses **S1** + short “one desk” headline |
| Assembly | **Clone-embed** from `143:2` (board remains source of truth) |
| Models | Cursor auto-routing (no forced Sonnet/Opus) |
| Copy | Marketing chrome only; do **not** rewrite UI mock text inside desk/chaos clones. Max one em dash in marketing deliverable (hero headline). |

## Page flow (live)

1. Nav  
2. Hero  
3. Platform logos  
4. Product proof  
5. **Problem** — “Does this sound familiar?” · 2×2 clones of P1–P4 + captions  
6. **Solution** — “One desk. Your entire practice.” · centered S1 clone  
7. **How it works** — 01–03 · H1 / H2 / H3 row + step labels  
8. Agents inside  
9. Closing CTA  

## Live marketing chrome (visionary PMM refine v2, shipped)

Tone: visionary category (system / mandate / practice). Zero em/en dashes. Zero rule-of-three adjective triads. Mechanical `check_ai_signs.py` exit 0. UI mocks untouched.

### Hero (`28:7`)
- Eyebrow / category: unchanged
- Headline: `Everything your practice runs on, in one place.`
- Sub: `The operating system for winning work and keeping every enquiry warm. Agents draft inside Broker OS. You stay on the gate for spend and sends.`
- Chip: `Draft ready. Waiting on your approval.`

### Platform logos (`66:2`)
- `CHANNELS THAT BUILD THE PRACTICE`

### Product proof (`28:16`)
- Eyebrow: `THE PRACTICE`
- Headline: `The whole practice, in one view.`
- Sub: `See the work that matters, and keep it moving.`

### Problem (`215:39`)
- Headline: `Does this sound familiar?`
- Sub: `Your best work is trapped between inbox, Ads Manager, and WhatsApp. The day never gathers itself.`
- Captions: Leads without a home · Campaigns that cost the week · Spend without a story · Deals that cool in silence

### Solution (`215:215`)
- Eyebrow: `ONE OS FOR THE PRACTICE`
- Headline: `One system. Your entire practice.`
- Sub: `The full arc of the mandate lives in one OS, with agents drafting inside and you still the authority on what ships.`

### How it works (`215:408`)
- Headline: `The mandate, end to end.`
- Sub: `Broker OS carries the practice from the first lead to the last follow-up, with you still deciding what goes live.`
- 01 Every lead arrives known · 02 Campaigns ready for your judgment · 03 Nothing goes cold

### Agents (`29:41`)
- Headline: `Agents belong in the OS, not another browser tab.`
- Body: Agents live inside Broker OS. They draft campaigns and keep follow-ups alive so the practice does not run on memory alone.

### Closing CTA (`29:46`)
- `Ready to give the practice one system?`

## Archive
- Move `29:2` and `29:26` off-page (e.g. x≥8000) renamed `Archive / The suite` and `Archive / How it works v1` — do not delete until QA pass.

## Hard fails
- BrokerDesk naming (use **Broker OS**)
- Broken clone (empty/white chaos cards)
- Leaving Suite + How stacked under new PSW (duplicate mid-page)
- Agents/CTA not reflowed (overlap or huge empty gap)
- Invented metrics / fake testimonials

## Out of scope
Next.js implementation, waitlist `3:4`, git commit unless asked.
