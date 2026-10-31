# Goldfish — Comprehension Review (BRAINSTORM mode)

**Scope:** `chat_campaign_research.md` (full) + the "Chat draft" paragraphs in `docs/designs/phase-1-listing-campaign-service.md` (the "Chat draft." paragraph and the Ryze-comparison paragraph right after it).

As a reader with no prior history on this project, here is what I think the feature is, and where I got stuck.

## My plain-English paraphrase

A chat already exists (`campaign-chat.ts` / `CampaignDraftChat`) that fills out a form one message at a time and, when done, turns that form into something called a "proposal" via a "Create Proposal" button. Today it only drafts Google Search campaigns for one hardcoded business. The plan is to reuse the same chat for a lease listing: swap in the listing's own facts, let the form also hold a spending ceiling and Meta ad copy, and let the consultant (or the owner) start the process from this chat instead of only by text message. The chat is still only allowed to *draft* — it cannot switch ads on. That still requires a code, or a manual click in some other screen called "the Desk," except for one kind of budget shuffle that's allowed to happen without asking.

I'm not fully confident in that paraphrase — see Finding 1 and Finding 3 below, which are the reasons I can't be sure.

## Findings

1. **Severity:** Blocker
 **Dimension:** UX & Developer Ergonomics
 **Usability Friction:** The word "agent" means two different things in this feature area, sometimes in the same document. In the Ryze description ("Clicking Create authorizes **the agent** to build and launch"), "agent" is Ryze's AI. In the Phase 1 goals ("**An agent** can send a lease listing by text... and approve it with a code"), "agent" is the human real-estate consultant/lease agent — the exact person this whole service is built for. A first-time reader cannot tell, on a first pass, whether a given sentence about "the agent" is talking about a human or a bot, which flips the meaning of the sentence (who is authorized to do what).
 **Ergonomic Requirement:** Pick one term for the human (e.g., "consultant," which the docs mostly already use) and reserve "agent" strictly for AI/automation, or add a one-line disambiguation note the first time either sense appears.

2. **Severity:** Major
 **Dimension:** UX & Developer Ergonomics
 **Usability Friction:** `chat_campaign_research.md` is written as a dependent addendum ("Does not replace concepts_brief.md or the Phase 1 design") but then uses "this service," "the card," "a proposal," "the Desk," and "a finding" throughout with no inline definitions. A reader who opens only this file (which is exactly how it's titled and filed — a standalone research note) has no way to resolve any of these terms without already having read the Phase 1 design first. The note doesn't link to the specific sections that define them.
 **Ergonomic Requirement:** Either inline a one-sentence definition for each term on first use, or add a pointer like "see Phase 1 design §Technical Plan for what a 'proposal' and 'the Desk' are."

3. **Severity:** Major
 **Dimension:** UX & Developer Ergonomics
 **Usability Friction:** Neither document ever says what "the card" literally *is*. Is it a database row, a UI form component, a JSON blob held in chat state? "Each turn fills a setup card," "the card can hold a ceiling and Meta copy," "CampaignDraftChat turns a finished card into a proposal" — three sentences that build a mental model on top of a noun that's never grounded in anything concrete.
 **Ergonomic Requirement:** One sentence stating what kind of object "the card" is (e.g., "an in-memory draft of the campaign fields, rendered in the chat UI") would remove this gap.

4. **Severity:** Major
 **Dimension:** UX & Developer Ergonomics
 **Usability Friction:** The Phase 1 "Chat draft" paragraph never uses the word "connector," but two paragraphs earlier ("What is new, and what is reused") and later in Non-Goals, "the chat connector" is introduced as a *separate* thing from the Desk chat — a way for external tools like ChatGPT/Claude to reach in. Read in isolation (as the task scope asks), the "Chat draft" paragraph gives no hint that there are two different "chat" surfaces (an internal Desk chat vs. a connector for external AI assistants), so a reader is likely to merge them into one concept and then be confused later when the doc treats them differently (e.g., only the connector "can create a draft and request a stop").
 **Ergonomic Requirement:** The "Chat draft" paragraph should name the connector and say explicitly "this is the Desk chat, not the external chat connector described below," or the two concepts should be merged/renamed so one noun doesn't cover both.

5. **Severity:** Major
 **Dimension:** UX & Developer Ergonomics
 **Usability Friction:** The sentence "Chat is the card, not that write" (end of the Ryze-comparison paragraph) is the single hardest line in the scoped text. "That write" is a backward reference to an unattended budget-shuffle behavior discussed in a different section (several paragraphs away, under "Moves inside the ceiling"), not anywhere near this sentence. A first-time reader has no antecedent to resolve "that write" against at the point they read it.
 **Ergonomic Requirement:** Spell it out: "Chat only produces a draft card; it does not perform the in-ceiling budget move that the monitor is allowed to do unattended."

6. **Severity:** Nit
 **Dimension:** UX & Developer Ergonomics
 **Usability Friction:** In `chat_campaign_research.md`'s "What this service does not copy" section, three distinct rejected behaviors are written as run-on fragments separated only by periods ("Launch when the user clicks Create. A default of skipping approvals. An unattended budget change..."), with no bullets or numbering. On a fast read this looks like one continuous thought rather than three separate items, and only close reading reveals it's a list.
 **Ergonomic Requirement:** Render as an actual bulleted list of the three rejected behaviors.

7. **Severity:** Nit
 **Dimension:** UX & Developer Ergonomics
 **Usability Friction:** The final sentence of `chat_campaign_research.md` — "The launch half spends the consultant's money with no code. That half stays rejected." — relies on a "draft half / launch half" split introduced only one paragraph earlier. It resolves correctly on a careful re-read but reads ambiguously on a first pass (it's momentarily unclear whether "that half" means the draft half or the launch half).
 **Ergonomic Requirement:** Replace "That half" with "The launch half" to remove the need to backtrack.
