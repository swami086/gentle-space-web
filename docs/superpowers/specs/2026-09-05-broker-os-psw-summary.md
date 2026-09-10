# Broker OS: Problem-Solution-How It Works — Implementation Summary

Date: 2026-09-05  
Status: **Ready for Figma implementation**

---

## What Was Completed

✅ **Step 1: Skills Catalog** — Gathered best skills from cursor global catalog:
- `copywriting` (conversion copywriting principles)
- `ideal-customer-profile` (audience understanding)
- `gtm-strategy` (go-to-market positioning)
- `customer-journey-map` (mapping user experience)
- `lean-canvas` (business model clarity)

✅ **Step 2: Research Using Mobbin MCP** — Analyzed 30+ landing page sections:
- **Problem sections**: Front, Vizcom, Lightdash, OpenPhone (empathetic pain listing)
- **Solution sections**: Vanta, Intercom, Grammarly (quantified outcomes, 3-column benefits)
- **How It Works**: Clay, Function, Runway, ToDesktop (numbered steps, visual progression)

✅ **Step 3: Research Using Firecrawl** — Validated best practices:
- Landing page structure (Unbounce best practices)
- Competitive messaging patterns (Ryze AI multi-platform positioning)
- Internal canonical workflow (`2026-09-05-broker-os-agent-lifecycle-workflow.md`)

✅ **Step 4: Content Creation** — Crafted comprehensive Problem-Solution-How It Works structure:
- **Problem section**: 4 pain points (leads scattered, campaigns take days, don't know what's working, follow-ups fall through)
- **Solution section**: 3 value pillars + control call-out (unified desk, campaigns drafted, see performance, human-gated)
- **How It Works**: 3-step process (Capture & Enrich → Draft & Approve → Track & Follow-up)

✅ **Step 5: Documentation Updated**:
- Created `2026-09-05-broker-os-problem-solution-how-it-works.md` (full content spec)
- Updated `2026-09-05-broker-os-marketing-messaging-design.md` (v12 section added)
- Updated `ads-agent/.agents/product-marketing.md` (v9.0.0 with PSW structure)

---

## Key Deliverables

### 1. Comprehensive Content Specification
**Location**: `docs/superpowers/specs/2026-09-05-broker-os-problem-solution-how-it-works.md`

**Contents**:
- Full copy for all three sections (Problem, Solution, How It Works)
- Design guidance (layout, tone, visuals, references)
- Copywriting principles applied (clarity, benefits, specificity, customer language)
- Implementation notes (Figma integration checklist, content assets needed)
- Validation against research (Mobbin patterns, Unbounce best practices, competitive differentiation)
- A/B testing opportunities for future optimization

### 2. Marketing Spec Update
**Location**: `docs/superpowers/specs/2026-09-05-broker-os-marketing-messaging-design.md`

**Changes**:
- Added v12 section documenting full research process
- Detailed breakdown of Problem, Solution, How It Works sections
- Next implementation steps clearly outlined
- Status updated to v12 with related docs referenced

### 3. Product Marketing Context Update
**Location**: `ads-agent/.agents/product-marketing.md`

**Changes**:
- Version updated to 9.0.0
- Added section 11: Marketing Page Structure (Problem-Solution-How It Works)
- Full copy for all pain points, value pillars, and workflow steps
- Copy tone guidance and CTA recommendations

---

## Content Overview

### Problem Section: "Does this sound familiar?"

**4 Pain Points**:
1. **Leads scattered everywhere** — WhatsApp, Facebook, portals, email all separate
2. **Campaigns take days to build** — Rebuilding Ads Manager from scratch for every listing
3. **Don't know what's working** — Can't tie spend to actual enquiries
4. **Follow-ups fall through the cracks** — Missed opportunities in scattered threads

**Design**: 2x2 grid (desktop), empathetic tone, simple line icons

### Solution Section: "One desk. Your entire practice."

**3 Value Pillars**:
1. **All leads in one place** — Unified queue with enriched context
2. **Campaigns drafted for you** — Brief to live campaign in minutes, not days
3. **See what works, what wastes** — Every rupee tracked back to enquiries

**Control Call-out**: Human-gated spend. Agents draft, you approve.

**Design**: 3-column layout + product shot, StackGen-inspired aesthetic

### How It Works Section: "Three steps. One desk. Human-approved every time."

**3 Steps**:
1. **Capture & Enrich** — Leads flow in, system enriches with context
2. **Draft & Approve** — Agents draft campaigns, you approve before spend
3. **Track & Follow-up** — See performance, unified queue, no tab-hunting

**Design**: Horizontal step progression with large numerals (01, 02, 03)

---

## Design Guidance Summary

### Visual System
- **Maintain**: StackGen-inspired palette, 6.5° slant on product shots (per v11.1)
- **Icons**: Hand-drawn vectors for platforms (Meta, Google, LinkedIn, WhatsApp)
- **Typography**: Bold numerals for steps, clear hierarchy
- **Layout**: Consistent with existing hero section

### Copy Principles Applied
✅ Clarity over cleverness  
✅ Benefits over features  
✅ Specificity over vagueness ("minutes, not days")  
✅ Customer language ("practice," "consultant," not "agent," "pipeline")  
✅ Active voice throughout  
✅ No jargon ("streamline," "optimize," "unlock" removed)

### CTAs
- **After How It Works**: "Start Your Free Trial" (primary), "Book a Demo" (secondary)
- **Final Section**: "Ready to run your practice from one desk?"

---

## Research Foundation

### Mobbin Inspiration
- **Problem patterns**: Direct questions (Front), empathetic listing (Lightdash), contrast (Vizcom)
- **Solution patterns**: Quantified outcomes (Vanta), illustrated benefits (Intercom), 3-column (Grammarly)
- **How It Works patterns**: Numbered steps (Clay), visual progression (Function), timeline (Runway)

### Best Practices (Unbounce)
✅ Message match across sections  
✅ Action above fold maintained  
✅ Product shown in action  
✅ Clear, compelling copy  
✅ Social proof placement options  
✅ Distractions removed

### Competitive Differentiation (vs Ryze, Lofty)
✅ **Consultant ICP** (not generic agents)  
✅ **Full commercial loop** (lead → enrich → campaigns → analytics → follow-up)  
✅ **Human-gated spend** (nothing spends until approve)  
✅ **India/WhatsApp-native**  
✅ **Category claim**: "Industry's first AI OS for Real Estate Consultants"

---

## Next Steps for Implementation

### 1. Figma Implementation
**Action**: Use `figma-use` skill to add three new sections to marketing page

**Sections to create**:
- **Section 28**: Problem (after hero)
- **Section 29**: Solution
- **Section 30**: How It Works

**Requirements**:
- Follow design guidance in `2026-09-05-broker-os-problem-solution-how-it-works.md`
- Maintain StackGen-inspired design system
- Use hand-drawn platform icons from hero
- Include product screenshots showing approval gates

### 2. Content Assets Needed
- [ ] 4 pain point icons (line style, consistent with hero)
- [ ] 3 solution icons (unified inbox, AI drafting, analytics)
- [ ] 3 step diagrams or product screenshots
- [ ] Platform logos (if not already created)
- [ ] Optional: Customer testimonial or logo bar

### 3. Copy Review
- [ ] Run final copy through `humanizer` skill for natural tone
- [ ] Verify all consultant/practice language (not agent)
- [ ] Confirm no jargon or buzzwords
- [ ] Check all specificity claims (e.g., "minutes, not days")
- [ ] Validate CTA clarity and action-orientation

### 4. Visual QA
- [ ] Verify product screenshots show approval gates
- [ ] Confirm unified desk visible in visuals
- [ ] Check slant on product shots (6.5° per v11.1)
- [ ] Ensure no clipping or cropping
- [ ] Validate platform icons consistent with hero

### 5. Ship Checkpoint
- [ ] User review of Figma implementation
- [ ] Final copy approval
- [ ] Visual QA complete
- [ ] Go-live decision

---

## Files Updated

1. **`docs/superpowers/specs/2026-09-05-broker-os-problem-solution-how-it-works.md`** ← NEW
   - Comprehensive content specification
   - Design guidance and implementation notes
   - Validation against research

2. **`docs/superpowers/specs/2026-09-05-broker-os-marketing-messaging-design.md`**
   - Added v12 section
   - Status updated
   - Related docs linked

3. **`ads-agent/.agents/product-marketing.md`**
   - Version 9.0.0
   - Section 11 added with full PSW structure

4. **`.firecrawl/` directory** (research artifacts)
   - `unbounce-landing-page-best-practices.md`
   - Search results for RE consultant pain points
   - Landing page structure research

---

## Skills Used

| Category | Skill |
|----------|-------|
| Copy | `copywriting`, `humanizer` |
| Strategy | `ideal-customer-profile`, `gtm-strategy`, `customer-journey-map`, `lean-canvas` |
| Research | `firecrawl-cli`, Mobbin MCP (`search_screens`, `search_sections`, `search_flows`) |
| Process | `superpowers:brainstorming`, `using-superpowers` |
| Design | Ready for `figma-use` |

---

## Summary

✅ **Research complete**: 30+ Mobbin examples analyzed, Firecrawl validation done  
✅ **Content complete**: Problem, Solution, How It Works fully written with copy principles applied  
✅ **Documentation complete**: All specs updated, v12 marked, related docs linked  
✅ **Ready for implementation**: Figma sections 28, 29, 30 can now be built  

**Next action**: Implement sections in Figma using `figma-use` skill with the comprehensive content spec as the source of truth.

---

**Status**: ✅ All research and content work complete  
**Version**: v12 (Problem-Solution-How It Works)  
**Last updated**: 2026-09-05
