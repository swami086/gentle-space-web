# Broker OS PSW Landing Assemble — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assemble Problem → Solution → How It Works on Figma Marketing frame `28:2` using clones of PSW product screens from board `143:2`.

**Architecture:** Clone-embed from asset board; archive Suite + old How off-page; reflow Agents + CTA; parent orchestrates layout geometry; optional parallel section polish via auto-routed agents.

**Tech Stack:** Figma Plugin API via `use_figma` · Inter typography · dark Broker OS tokens · OpenMemory project `swami086/gentle-space-web`

## Global Constraints

- File `bZ7LkDipySdYsNGH0YBtGu`, page `BrokerDesk Waitlist`, marketing `28:2`
- Clone sources: P1–P4 `143:3–6`, S1 `143:7`, H1–H3 `143:8–10`
- Brand: Broker OS · language: practice / enquire / approve
- Models: Cursor auto-routing
- No git commit unless user asks
- Skills: `figma-use`, `high-end-visual-design`, `verification-before-completion`

---

### Task 1: Archive Suite + old How; resize page scaffold

**Files:** Figma nodes `29:2`, `29:26`, `28:2`

- [ ] Rename + move Suite and How to archive x≥8000
- [ ] Note Product proof bottom edge (~1864) as Problem start Y
- [ ] Temporarily expand `28:2` height to ≥5200 to absorb new sections

### Task 2: Build Problem section

- [ ] Create frame `Problem` 1440×~1180 inside `28:2`
- [ ] Add eyebrow/headline/sub from PSW copy
- [ ] Clone P1–P4; scale into 2×2; add captions
- [ ] Screenshot QA

### Task 3: Build Solution section

- [ ] Create frame `Solution` 1440×~900
- [ ] Eyebrow + headline + one supporting line
- [ ] Clone S1; scale ~1040–1120; center
- [ ] Screenshot QA

### Task 4: Build How it works section

- [ ] Create frame `How it works` 1440×~560
- [ ] Eyebrow + headline; clone H1–H3 in row with 01/02/03 labels
- [ ] Screenshot QA

### Task 5: Reflow Agents + CTA + page height; board QA

- [ ] Stack Problem → Solution → How under Product proof with consistent vertical rhythm (~28–48px)
- [ ] Place Agents then CTA below How; set `28:2` height to content + padding
- [ ] Full-page screenshot; hard-fail check
- [ ] Update `.superpowers/sdd/progress.md` + OpenMemory + `openmemory.md`
