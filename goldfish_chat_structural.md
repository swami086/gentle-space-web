Structural Goldfish — BRAINSTORM review of `chat_campaign_research.md`

**1. Is `chat_campaign_research.md` safe to leave beside the design?**
Severity: Nit
Dimension: Long-Term Tech Debt & Maintainability
Tech Debt Description: Mostly yes. The file already disclaims itself in its first bullet ("Does not replace concepts_brief.md or the Phase 1 design. The design now carries the decision."), so it will not be mistaken for a second source of truth by a careful reader. Its own heading hierarchy is clean — one H1, five sequential H2s, no skipped levels. The remaining risk is small: it sits in the repo root, not under `docs/`, with no "status: research, superseded by design" marker in its title, so a reader who opens it without reading the disclaimer bullet first (e.g. jumping straight to a H2) could still treat it as live guidance once the design changes again and this file doesn't.
Maintainability Requirement: Fine to leave as-is for now. If it survives past this cycle, add a one-line "Superseded by [the design](docs/designs/phase-1-listing-campaign-service.md)" note at the very top, before the date line, so the disclaimer is the first thing seen regardless of where the reader's eye lands.

**2. What must not be copied into concepts_brief.md?**
Severity: Major
Dimension: Long-Term Tech Debt & Maintainability
Tech Debt Description: Two things from this file don't match the brief's own structural conventions, and copying them verbatim would create drift:
- The headings themselves ("What already exists in this repo", "What Ryze actually does", "What this service copies", "What this service does not copy"). `concepts_brief.md` uses numbered headings (`## 6.` / `### 6.12`) throughout; these plain question-style H2s don't fit that template and would read as a foreign section if dropped in as-is.
- The "Source: [link]." trailing-citation style used after several bullets. The brief and the design both cite inline instead (`([Managed Campaigns](...), read 2026-10-30)`). Mixing both citation styles in the same document is the kind of small inconsistency that compounds over many edits.
The design document already avoided both problems — it folded the content into a bold lead-in sentence ("**Chat draft.**") matching its neighboring paragraph ("**What is new, and what is reused.**") and used the brief's inline-citation convention. That's the pattern to repeat if this content also lands in the brief, not a copy-paste of this file's section.
Maintainability Requirement: When this content is merged into concepts_brief.md, rewrite it into the brief's existing numbered-heading and inline-citation shape rather than importing this file's headings or "Source:" lines wholesale.

**3. Which heading is missing?**
Severity: Major
Dimension: Long-Term Tech Debt & Maintainability
Tech Debt Description: The last paragraph of the file (starting "The counter-argument: without launch-on-create, this is not Ryze's managed campaign...") sits under the "## What this service does not copy" heading but argues a different point — why the launch half is rejected outright, not what was or wasn't copied. The file's own pattern up to that point is one heading per idea (exists / Ryze's real behavior / competitor's account / copies / doesn't copy); this last idea breaks that pattern by riding along under the previous heading instead of getting its own.
Maintainability Requirement: Give that closing paragraph its own heading, e.g. "## Why the launch half stays out," so the file's heading-per-idea symmetry holds and a reader skimming headings doesn't miss the rejection rationale.
