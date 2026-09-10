# Broker OS — PSW Chaos Cards v2 (P1–P4 redo)

Date: 2026-09-05  
Status: **shipped — Mobbin craft rebuild (2026-09-05)**  
Parent: `2026-09-05-broker-os-psw-product-ui-quality-rebuild-design.md`  
Figma: `bZ7LkDipySdYsNGH0YBtGu` · page `BrokerDesk Waitlist` · board `143:2`

## Locked decisions (brainstorm)

| # | Decision |
|---|----------|
| D | Full scrap + rebuild (not recolor/polish) |
| C | Hybrid craft: lookalike chrome + heightened density for board scale |
| B | Same pains, **new compositions** (not old layout) |
| Theme | Dark desk palette (match S1/H*), not light Ads Manager white |
| Models | Sonnet-class ×4 parallel (no Opus) |

## Why redo

v1 dark recolor left P1–P4 as tinted wireframes — muddy midtones, weak hierarchy, low Mobbin fidelity. Marketing miniatures must read as real foreign UIs at 560×360.

## Rebuild contract

| Frame | Name | New composition | Must keep |
|-------|------|-----------------|-----------|
| `143:3` | P1 Chaos / Scattered leads | Layered 3-channel stack: Mail list (back) → Meta lead toast (mid) → WhatsApp bubble (front, ≤6° tilt). Official logos. Badges **7 / 3 / 12**. | No Broker OS / Approve |
| `143:4` | P2 Chaos / Campaign setup | **Dark** Ads Manager: left nav Campaigns/Ad sets/Ads (blue `#1877F2` active), empty Audience, dashed `+ Add creative`, Budget with **₹**, 3-day calendar with **strikethrough** (not X). Meta logo from kit. | Foreign chrome only |
| `143:5` | P3 Chaos / Blind spend | Dark analytics card: Spend `₹50,000` · Enquiries `???` · empty chart / “No activity” · footer **Which ad?** | Not desk chart styling |
| `143:6` | P4 Chaos / Missed follow-up | Dark WhatsApp thread: Priya Menon / Whitefield, aged inbound, red pill **Missed · 6 days**, official WA mark. | No Broker OS |

### Shared tokens

- Frame: **560×360**, radius **12–14**, `clipsContent: true`
- Surfaces: `#191A1B` (window) · `#202124` (sidebar/chrome) · `#28292E` (elevated/fields) · border `#373740`
- Text: primary `#EBEBED` · muted `#9CA3AF`
- Accents: Meta blue `#1877F2` · WA green `#25D366` · missed red `#EF4444`
- Logo kit instances: WA `136:8` · FB `137:5` · Meta `137:11` · Google `137:17` · LI `137:22` (scale to ~16–24px marks)

### Hard fails

- Broker OS wordmark, Approve button, or unified desk sidebar on any P frame
- Crude calendar X; missing ₹ on P2 budget; missing Missed pill on P4
- Hand-drawn fake logos (must use kit instances)
- Light/white primary card surfaces (dark theme required)
- Sparse wireframe density (must feel Mobbin-grade at board scale)

## Approach

1. Shared dark foreign-UI token strip (parent)
2. Clear `143:3–6` children
3. Four parallel Sonnet agents rebuild one card each
4. Parent screenshot QA + optional Mobbin craft pass

## Out of scope

S1 / H1–H3, marketing embed `28:2`, git commit unless asked.
