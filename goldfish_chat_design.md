# Goldfish Design Critique — Chat drafts a listing campaign

Mode: BRAINSTORM. Grounded in `ads-agent/lib/decision-engine/campaign-chat.ts`, `ads-agent/lib/openui/campaign-library.ts`, `ads-agent/lib/types.ts`, `ads-agent/lib/decision-engine/campaign-draft-rules.ts`, `chat_campaign_research.md`, and the "Chat draft" section of `docs/designs/phase-1-listing-campaign-service.md`.

---

**Severity:** Blocker
**Dimension:** Architectural Bottlenecks
**Risk Description:** `SetupCard` is a positional-only OpenUI Lang schema (`additionalRules`: "arguments are POSITIONAL only... NEVER assistantReply=... or status:..."). Today it has 8 fields for one platform. The concept adds listing facts, a per-platform ceiling (Meta lifetime budgets, Google total budgets — Phase 1 design wants 3-5 shares per platform), and full Meta copy (primary text, headline, description, image reference) on top of existing Google copy. That roughly triples the positional argument count on a schema where the model must count position exactly and the few-shot examples (`buildCampaignPromptOptions`) must be rewritten to match every time a field is inserted anywhere but the end. The concept note treats this as "the card can hold the ceiling and Meta copy" — a data-model add. It is a grammar redesign with a correspondingly higher mis-position and parse-error rate, and no version of the examples array handles that scale today.
**Mitigation Requirement:** Either split into multiple cards (one per platform, one for listing facts, one for the ceiling) each with their own small positional schema and parser, or move off strict positional args before expansion. State which, and show the example strings for the expanded shape before this ships.

---

**Severity:** Blocker
**Dimension:** Cost, Quota & Token Economics
**Risk Description:** `runDraftModel` hardcodes `maxTokens: 4096` and the flow already needs a silent `topUpDescriptions` side-call because one platform's copy doesn't reliably fit in one completion with everything else. Worst case today is already up to 4 model calls per user turn (first draft, parse-error retry, validation-error retry, descriptions top-up with its own one retry), each metered against the org's AI credit ledger via `callMeteredStreamingChatCompletion`. Doubling the schema (listing facts + ceiling + two platforms' copy) raises both the output size per call and the odds of hitting `validateDraftFields` rejections, which is what triggers the retry branches. Nothing in the concept revises `maxTokens`, caps total retries per turn, or puts a ceiling on credits burned by one chat turn.
**Mitigation Requirement:** State a token budget per field category (listing facts / Meta copy / Google copy / ceiling) that sums to a known worst-case completion size, and cap total model calls per user turn regardless of how many fields fail validation. Without this, a chatty consultant on a bad connection can burn an unbounded number of calls per turn.

---

**Severity:** Major
**Dimension:** Architectural Bottlenecks
**Risk Description:** The system prompt and the few-shot examples are hardcoded Gentle-Space load-bearing guardrails, not placeholder text: `PRODUCT_CONTEXT` names Bangalore CRE corridors from `STRATEGY.corridors`, and `additionalRules` includes "Product is Gentle Space CRE (office/retail/warehouse space search in Bangalore) — never invent residential/luxury apartment campaigns." The concept's plan to swap in "listing facts instead of that paragraph" is described as a substitution, but Phase 1 explicitly includes India residential listings and Australia residential listings. A system prompt still anchored to a hardcoded "never invent residential" instruction will fight the model on exactly the listing types this feature needs to support, and the few-shot examples (all Bangalore CRE) will keep pulling output toward Gentle Space's voice regardless of the listing injected at runtime.
**Mitigation Requirement:** Define how the system prompt and examples are built per-listing (property type, market, corridor/suburb) before the first non-Gentle-Space, non-commercial listing is drafted, not after a pilot produces an office-voiced residential ad.

---

**Severity:** Major
**Dimension:** Architectural Bottlenecks
**Risk Description:** Lease-compliance rule packs (`rules/india.ts` blocking discriminatory/sales language, `rules/australia.ts` requiring one fixed rent) are described in the Phase 1 design as gating the proposal pipeline. `campaign-chat.ts`'s own validation (`validateDraftFields`) only checks Google RSA character/count limits — nothing about discriminatory wording or rent format. The concept doesn't say whether the rule pack runs inside the chat loop (another model/validation round trip per turn) or only at Create Proposal time. If it's deferred, the consultant can get several "looks good" turns in chat, draft a finished-looking card, click Create Proposal, and only then learn the copy is rejected — after the chat already told them it was done, which is itself close to the overclaim this concept is supposed to avoid ("must not claim it launched a campaign" protects against overclaiming completion; this is the same failure mode one step earlier).
**Mitigation Requirement:** Decide explicitly where lease-rule validation runs relative to the chat loop, and make the chat surface tell the consultant the draft is still subject to that check, not "ready."

---

**Severity:** Major
**Dimension:** Architectural Bottlenecks
**Risk Description:** `CampaignDraftStatus` is `"chatting" | "ready" | "converted"` and `CampaignDraft.proposalId` is a single nullable string — a one-draft-to-one-proposal-to-one-platform model. The concept wants one chat session to produce a ceiling plus Meta copy plus Google copy, i.e. one draft feeding (at least) two platform-specific campaign builds under one shared ceiling. Nothing in `types.ts` models a multi-platform draft, and the concept doesn't say whether this is one draft with a wider `CampaignDraftFields`, or two synced drafts, or a draft that produces two proposals sharing one ceiling value. This is a real fork in the data model, not an additive field, and the wave plan (`campaign-chat.ts` and `CampaignDraftChat.tsx` edited together in wave 5) implies it's being treated as a same-file tweak.
**Mitigation Requirement:** Pick one of the three shapes above and show the updated `CampaignDraftFields`/`CampaignDraft` types before assigning this to a single wave-5 edit.

---

**Severity:** Major
**Dimension:** Architectural Bottlenecks
**Risk Description:** "Chat may draft a finding" bolts a second, unrelated lifecycle stage onto `campaign-chat.ts`. Findings (pause, end early, lower/raise ceiling, extend end date) are a post-launch monitoring concept living against a running listing's shares (`decision-engine/rules.ts`), with their own code-approval path ("a finding changes nothing until the consultant replies with its code"). `CampaignDraft`/`CampaignDraftFields` has no finding-shaped fields at all — it's built around a pre-launch `SetupCard`. Routing finding-drafting through the same chat module that only knows how to emit `SetupCard` conflates pre-launch setup with post-launch monitoring under one component, one schema, and implicitly one approval surface, with no description of how a drafted finding is represented, stored, or distinguished from a draft campaign in the UI so the consultant can't confuse "approve this finding's code" with "approve this ceiling's code."
**Mitigation Requirement:** Either keep finding-drafting out of `campaign-chat.ts` as a separate chat surface with its own schema and its own code-approval wiring, or specify the shared schema and show how the two approval codes stay distinguishable to the consultant in one chat thread.

---

**Severity:** Nit
**Dimension:** Cost, Quota & Token Economics
**Risk Description:** The concept frames parity with Ryze's defaults ("skip all approvals", launch-on-create) purely as a behavior to reject, which is correct, but doesn't note the cost asymmetry: Ryze's model amortizes one setup conversation across launch-on-create, while this design keeps the setup conversation (with its multi-call retry pattern above) *and* a separate text-approval round trip *and* a separate executor run. That's the right safety trade for this concept, but it means the token/SMS cost of getting one listing live is strictly higher per listing than the pattern being rejected, compounding with the token growth from Finding #2 above.
**Mitigation Requirement:** No action beyond acknowledging it in the cost model for the pilot stage — the owner should expect per-listing chat+approval cost to rise, not stay flat, as the schema grows.
