# Stack review: agent frameworks versus the listing workflow

* **Date:** 2026-10-30
* **Status:** Research before a Goldfish review. Does not replace [concepts_brief.md](concepts_brief.md) or [docs/designs/phase-1-listing-campaign-service.md](docs/designs/phase-1-listing-campaign-service.md).
* **Skills used:** skill picker pointed at `claude-api`, `mcp-server-builder`, an ElevenLabs voice `agents` skill, `ad-creative`, and `product-proof-saas`. Those do not decide an orchestration runtime. The engineering-advanced router lists `agent-designer` for this question. That skill's planner was run. Its output is recorded below and not adopted.

## What the repo is

`ads-agent` is a Next.js 15 app. Dependencies include the Meta and Google Ads client libraries, Postgres, Zod, and the MCP SDK. There is no LangGraph, Mastra, Vercel AI SDK, OpenAI Agents SDK, or Claude Agent SDK in `package.json`. Waiting for a person is already a worker: `worker:proposals` runs the undo window, and proposals move through scheduled and executing states.

The listing workflow is a fixed sequence. Intake, planner, copy, rule check, text approval, paused build, read-back, switch-on, then a daily share move. The model is allowed to write copy and a short explanation. It is not allowed to write amounts, codes, or platform calls.

## What the frameworks actually are

* **Mastra** (TypeScript, 1.0 in January 2026). Workflows can suspend until a person resumes them, including an `approved` flag ([Mastra suspend and resume](https://mastra.ai/docs/workflows/suspend-and-resume), [human-in-the-loop](https://mastra.ai/docs/workflows/human-in-the-loop)). It also has an agent loop that can ask before a tool call. A 2026 comparison ranks it first for TypeScript production agents and notes the docs lag the releases, so tutorial snippets fail to compile ([AgentMail, 2026](https://www.agentmail.to/blog/best-ai-agent-frameworks-2026)).
* **LangGraph.** A graph runtime with checkpoints and human gates. The same comparison treats the strong version as Python. A TypeScript port would be a second dialect beside this repo.
* **Claude Agent SDK.** Official description: "The Agent SDK gives you the same tools, agent loop, and context management that power Claude Code." It is a tool-using loop inside a process you run ([Claude Code docs](https://code.claude.com/docs/en/agent-sdk/overview)). It is not a durable wait for a WhatsApp code, and it is not a spend cap.

## What the planner script said

`agent-designer`'s planner scored the listing tasks as a **supervisor** with two agents and an 8–12 week estimate. The tools it attached were a file manager, a data analyzer, and a code executor. Those tools are the script's defaults. They are not Meta, Google, or WhatsApp. Building that pair would add a coordinator that can call code, which is the opposite of a closed list of platform writes. The score is discarded.

## Hypothesis

Do not put an agent framework under the spend path.

Mastra's suspend/resume is the only feature that resembles the approval wait. The proposal worker already is that wait, and Gentle Space's live campaigns already use it. A second engine means two places that can decide an action is approved. The share move is a sum check, not a tool the model should choose. The Claude Agent SDK can call tools in a loop. That loop does not know the ceiling, the kill switch, or the allowlist unless every rule is reimplemented as a tool guard, which is the proposal engine again.

The robustness work is in the design already: one connection per customer, paused create, read-back, idempotency keys, the share sum, and the kill switch. A framework does not add those.

Leave the model calls where they are. Copy stays behind the citation gate. The explainer writes only the reason text. The parser runs after fixed rules. Those three calls do not need a graph runtime.

## What this would get wrong

The counter-argument is that Mastra's studio, traces, and evals are the "advanced" part, and bolting them on later is harder. That is true for a product whose core is an open agent. It is not true here. The core is a platform write that must match an approved ceiling. Tracing can be a span around the existing worker. It does not require replacing the worker.

If the Goldfish review is run, the question to attack is narrow: is there a failure of the current proposal worker that Mastra's suspend actually fixes, and that a smaller change to the worker does not.
