# Zoom-out: chat drafts a listing

Mode: BRAINSTORM. Read `chat_campaign_research.md` and the Phase 1 design's chat-draft paragraph. Plain English below.

## 1. Cut: the finding draft

**Severity:** Blocker
**Dimension:** YAGNI & Code Minimization
**Challenge/Risk:** The design doc already has one place that produces a finding: the daily monitor, through `rules.ts`, texted with a code. The concept adds a second place — chat drafts a finding too. That's two finding-producers feeding one approval code, with no stated rule for what happens when they disagree about the same listing on the same day, or whether a chat-drafted finding can race a monitor-drafted one for the same code slot. Nothing in the committed design asks for this. It's new surface the research note introduces, not something Phase 1's goals need.
**Alternative / Reuse Opportunity:** Cut it. If the consultant wants a finding on demand, that's a request to the existing monitor logic ("run the check now"), not a separate drafting path inside chat. One finding-producer, one place it's defined, one place it's tested.

## 2. Cut, or at least don't build in Phase 1: the listing chat itself

**Severity:** Major
**Dimension:** YAGNI & Code Minimization
**Challenge/Risk:** The design's own Non-Goals section calls the chat connector "a beta for pilots, not a requirement for the first market," and the four exit cases in Goals are all reached through WhatsApp/SMS text and the signed listing page — not chat. Chat is for "the owner on the laptop." That's Gentle Space's existing habit, not something a pilot consultant in India or Australia needs to hit any Phase 1 goal. Widening `campaign-chat.ts` to hold a ceiling and two platforms' copy, instead of one platform and a hardcoded paragraph, is real work sitting in the same wave as the executor, the rule packs, and the text-approval router — none of which need it to pass.
**Alternative / Reuse Opportunity:** Leave `campaign-chat.ts` as the single-business, Google-only tool it is today. Point the owner at the listing page like everyone else. Revisit chat when a pilot actually asks for it.

## 3. If it ships anyway: don't let chat draft copy a second way

**Severity:** Major
**Dimension:** Reinventing the Wheel
**Challenge/Risk:** The main path writes copy through one drafter, gated by the grounding pack and the citation gate, then checked by `rules.ts`/`india.ts`/`australia.ts` before a code goes out. `campaign-chat.ts` drafts copy its own way, through OpenUI's prompt-and-card loop, with its own instructions baked into `buildSystemPrompt`. Pointing that same loop at Meta copy and a ceiling, instead of just Google text, means the system prompt — not the rule pack — is what's supposed to keep the chat path honest. A prompt is not a record this service controls, which is the exact reason a raw write-access chat was already rejected elsewhere in this design. The same reasoning applies to copy.
**Alternative / Reuse Opportunity:** If the chat stays, it should call the same drafter and rule-pack functions the main path calls, and only use its own words for the reply line. Don't give the model a second instruction set that's supposed to re-derive "no sales language in India" or "one fixed rent in Australia" from a paragraph in a prompt.

## 4. Is "add Ryze's chat" a second product?

No — not as scoped in the concept. The concept explicitly keeps Create Proposal as a button and keeps the approval code as the only thing that switches ads on; the only unattended write stays the in-ceiling share move, which was already approved. A chat that only fills fields on a card that a human still has to approve isn't a new product, it's a second way to fill in the same draft a WhatsApp message or the listing page already fills in.

The thing that would make it a second product is cut #1 above — a chat that can also draft findings. A finding is a recommendation that changes what the consultant is asked to approve. Once chat can generate that on its own, separately from the monitor, you have two systems deciding what to ask the consultant for, and that's the start of a second, chat-shaped decision path running next to the one this design already built. Keep chat to filling the card. Don't let it touch findings.
