# Agent topology: Hermes profiles, Kanban, and the MCP context server

Date: 2026-08-12
Status: draft for review
Companions: `2026-08-12-unified-datastore-context-graph-design.md` (§7 defers to this document),
`2026-08-12-backend-features-design.md`, `2026-08-11-tenancy-authz-foundation-design.md`

## 1. Scope

Six specialised AI agents that can talk to each other and share full context across the data
model, built on Hermes. This document defines the profiles, how they coordinate, the tool surface
they share, and — most importantly — the boundary on what they are permitted to do.

Out of scope: broker-facing agents. Hermes is single-host with a trusted-local-user threat model,
so agents remain internal until that is solved.

---

## 2. Decisions

- **AG1 — Agents propose, humans dispose.** Agents have exactly one write tool: `create_proposal`.
  They cannot spend money, send messages, or mutate domain state. See §3.
- **AG2 — One Hermes profile per specialisation.** Six profiles, each with its own home, config,
  memory, and command alias.
- **AG3 — Kanban is the coordination substrate.** `delegate_task` is permitted only for short
  synchronous sub-answers within a single run.
- **AG4 — One shared MCP context server** provides all data access. No agent talks to Postgres,
  ClickHouse, or PuppyGraph directly.
- **AG5 — Tenant is bound by the dispatcher, never chosen by the agent.** Enforced with a
  per-task token (§6).
- **AG6 — Email drafting is a capability, never a send.** Preserves BD2 from the backend spec.
- **AG7 — Start with one agent.** The roster is specced in full; only `leads` is built first (§11).

---

## 3. The safety property

This is the load-bearing design decision, so it comes before the roster.

**Agents can read everything in their tenant and write exactly one thing: a proposal.**

Every action an agent wants to take in the world becomes a row in `proposals`, which is the
existing human-gated approval mechanism the admin screens already render. The agent supplies the
proposed change, a plain-language rationale, and its evidence. A human approves, edits, or rejects.
The undo window from the UX spec still applies after approval.

This means no new trust boundary has to be invented for agents. They plug into the gate that
already exists, and an agent that malfunctions produces a bad *suggestion*, not a bad *outcome*.
It also means the audit trail for agent-initiated change is identical to human-initiated change.

Concretely, the following are impossible by construction, not by prompt instruction:

- Spending money — `campaign.create` and `campaign.budget_change` are proposal kinds, not actions.
- Contacting a client — there is no send tool. The guarantee rests on the tool surface, not on the
  current absence of a sending library: if the deferred G2 digest email is ever adopted, sending
  stays outside the agent tool surface.
- Changing a requirement — `enquiry.requirement_update` is a proposal the broker confirms, matching
  the "Update the requirement" button already designed on the log-call screen.
- Cross-tenant reads — the tenant is pinned by the dispatcher and enforced by row-level security.

---

## 4. Profile roster

| Profile | Owns | Primary output |
|---|---|---|
| `orchestrator` | routing work, decomposition | kanban tasks assigned to others |
| `leads` | enquiry triage, signals, requirement extraction | `enquiry.requirement_update`, message drafts |
| `campaign` | ad campaign drafting and tuning | `campaign.create`, `campaign.budget_change` |
| `performance` | spend, cost per enquiry, what to change | `campaign.pause`, analytical briefs |
| `content` | website copy, listing content | `content.page_update`, `listing.update` |
| `research` | competitor and corridor intel | briefs attached to kanban tasks |

**`orchestrator`** is the only profile that routinely calls `kanban_create`. It decomposes a
request into tasks, assigns each to the profile whose description matches, and links dependencies
so the dispatcher promotes `todo → ready` when parents complete. Give it `--description` metadata
for each worker profile so routing has something to match against.

**`leads`** reads the enquiry thread, derives signals ("asked about pricing twice"), extracts
structured requirements from call notes, and drafts messages the broker sends themselves. This is
the agent closest to daily broker value and the one built first.

**`campaign`** drafts campaigns against a corridor. It must read current performance before
proposing, and its proposals carry the pre-flight check results defined as E2 in the backend spec.

**`performance`** is the only agent that reads the ClickHouse mirror rather than Postgres, because
it is a pillar-four analytical workload. It produces briefs and pause proposals.

**`content`** proposes website and listing copy. Blocked until CMS backend features (H1–H7) exist;
specced here so the roster is complete.

**`research`** uses web tools rather than the context server for most of its work, and attaches
findings to kanban tasks for other agents to consume.

---

## 5. The MCP context server

One HTTP MCP server, shared by all profiles, configured with an identity header set to
`value_from: profile` so the server knows which agent is calling. This is the mechanism that gives
"full context across the data model" — memory providers cannot, being per-profile isolated.

### Read tools

| Tool | Parameters | Returns |
|---|---|---|
| `search_spaces` | `query: string`, `filters?: {corridor, min_desks, max_desks, max_price_per_desk}` | ranked `Space[]` (pgvector + AGE) |
| `get_space` | `space_id: uuid` | `Space` with pricing, capacity, amenities |
| `list_enquiries` | `status?: 'waiting'\|'called'\|'closed'`, `since?: iso8601`, `limit?: int` | `EnquirySummary[]` |
| `get_enquiry` | `enquiry_id: uuid` | thread, requirement, activity, derived signals |
| `get_campaign_performance` | `window_days: int`, `corridor?: string` | `CampaignMetric[]` from ClickHouse |
| `list_proposals` | `status?: 'pending'\|'scheduled'\|'approved'\|'rejected'` | `Proposal[]` |
| `graph_query` | `template: <allowlisted name>`, `params: object` | `Row[]` from a tenant-scoped view |
| `get_context_pack` | `entity: 'enquiry'\|'space'\|'campaign'`, `id: uuid` | the grounding allowlist (F4) |

`get_context_pack` is what an agent calls before generating anything user-visible. It returns
exactly the facts the agent is permitted to cite, which makes grounding auditable — if a claim
is not in the pack, it was invented.

**Every pack carries its own age** (added 2026-08-12). Agents read a graph projected from a CDC-fed
mirror, so a stalled pipeline makes an agent propose confidently on stale data — and a budget change
justified by three-day-old spend looks exactly like a correct one. Each pack therefore returns
`built_at` and current CDC lag alongside the facts: an agent cannot obtain data without also
obtaining how old it is. Above a lag threshold (default 15 minutes) agents **refuse to propose
anything that changes spend**. Refusing is correct behaviour, not a failure. The lag at creation is
stored on the proposal and shown to whoever approves it.

**`graph_query` takes a template name and values — never query text** (revised 2026-08-12). The
original design accepted free-form Cypher and injected a tenant predicate server-side. Security
review found that structurally unsound: statement-type validation is a denylist, and read-only
statements still exfiltrate through subqueries against system catalogs, CTEs, `UNION` branches that
escape a top-level predicate, and blind timing oracles that leak a bit at a time.
[Cypher injection](https://neo4j.com/developer/kb/protecting-against-cypher-injection/) behaves the
same way. Textual predicate injection cannot be made safe.

Instead: a fixed set of named traversal templates, each a parameterised query the model can only
supply *values* to, executed against **views that already embed the tenant predicate** — so there is
nothing left to inject. New traversals are added by writing a template, not by the model composing
one. Defence in depth: `default_transaction_read_only`, a `statement_timeout`, and a row cap.

**The MCP server connects as a non-owner role with `SELECT` only.** Postgres table owners ignore row
security unless `FORCE ROW LEVEL SECURITY` is set — a server connecting as owner would set the
tenant variable correctly and enforce nothing. A CI test must assert that a cross-tenant read fails.

### The only write tool

```
create_proposal(
  kind: 'campaign.create' | 'campaign.budget_change' | 'campaign.pause'
      | 'enquiry.requirement_update' | 'content.page_update'
      | 'listing.update' | 'message.draft',
  payload: object,          // shape validated per kind
  rationale: string,        // plain language, numbers-forward, broker-readable
  evidence: string[]        // ids from the context pack that justify it
) -> { proposal_id: uuid }
```

`message.draft` is how the email-drafting capability lands: it produces a draft the broker copies
into their own inbox. Nothing is sent.

A proposal with an empty `evidence` array is rejected by the server. An agent that cannot cite its
reasoning does not get to propose.

---

## 6. Tenant binding

The risk: if an agent passes `org_id` as a parameter, a confused or compromised agent reads another
broker's data. So it does not pass one.

1. The dispatcher spawns a worker for a kanban task that carries a `--tenant` value.
2. The dispatcher mints a short-lived **task token** binding `(task_id, profile, org_id)`.
3. The worker passes the token to the MCP server on every call.
4. The server derives `org_id` from the token — never from a parameter — and opens its database
   session with `set_config('app.current_tenant_id', <org_id>, true)` inside the same transaction
   as the query, exactly as the API does.
5. Row-level security in Postgres and the row policy in ClickHouse enforce it at the storage layer.

Defence in depth: the agent cannot name a tenant, the server sets context per request, and RLS
backstops both. This is the rule from the tenancy design applied to workers rather than API
handlers, and it is why kanban's `--tenant` is more than a label here.

Tokens expire with the task. A crashed-and-reclaimed worker gets a fresh one.

**The token must bind intent, not only scope** (added 2026-08-12). Binding `(task_id, profile,
org_id)` scopes *which tenant*, but within the TTL an injected agent may still call any read tool.
Embed the profile's tool allowlist in the token, revoke server-side on task completion, and deliver
tokens over a unix socket using `SO_PEERCRED` rather than environment variables or files. Never log
a token to Kanban.

**One uid per agent profile, minimum.** Hermes runs all profiles under the operator's uid with no
filesystem sandbox, so any agent able to read another's memory, argv, environment or the Kanban
SQLite file inherits its tenancy — which defeats the token entirely. Per-profile uids are the floor;
per-tenant containers are the target before external users exist.

**Cost ceilings are a security control, not an optimisation.** The public enquiry form is
unauthenticated and triggers multi-agent inference that fans out across Kanban hops. Per-tenant
budget ceilings must **halt** inference rather than warn, with per-task caps on tool calls and agent
hops behind a circuit breaker, length caps on enquiry text, and bot mitigation on the form.

---

## 7. Kanban task shapes

Status flow is `triage → todo → ready → running → blocked → review → done`.

**Comments are the inter-agent protocol.** A re-spawned worker reads the full comment thread as
part of its context, so agents communicate by appending findings rather than by passing arguments.

> **Comments launder untrusted text — mitigate deliberately** (added 2026-08-12). The `leads` agent
> reads hostile-capable text (public enquiry forms, inbound email) and writes a comment; another
> agent then consumes that comment as trusted peer output. This is documented inter-agent trust
> escalation, with [100% success rates reported](https://arxiv.org/html/2603.09134v1) against
> AutoGen, CrewAI and MetaGPT. Two controls, both required:
>
> - **Typed messages, not prose.** Inter-agent comments carry an enum intent plus record IDs, not
>   free text an agent can be talked into obeying.
> - **Taint labels, propagated transitively.** A message derived from untrusted input stays marked,
>   and a tainted input can never produce a proposal without human review of the source text.
>
> Also strip tag-block (U+E0000–E007F), variation-selector and zero-width characters at every
> ingest and render boundary, so a proposal cannot display differently from what it executes.

Task conventions for this system:

- **Title** states the outcome, not the activity: "Propose budget for Koramangala after Q3 dip",
  not "Analyse Koramangala".
- **Tenant** is always set. A task without one is a bug; the dispatcher should refuse it.
- **Workspace** is `scratch` for analysis tasks and `dir:<absolute path>` for content tasks that
  need durable files. Scratch is deleted on completion unless files are declared as artifacts.
- **Links** express dependency: a `campaign` proposal task links to the `performance` analysis task
  that justifies it, so it only becomes `ready` once the analysis is `done`.
- **Idempotency keys** on any task created by automation, so a retried webhook does not duplicate.

### Worked example

A weekly budget review, showing the coordination pattern end to end:

1. Cron creates a task assigned to `orchestrator`, tenant `acme-retail`, with an idempotency key.
2. `orchestrator` calls `kanban_create` three times: a `performance` analysis task, a `research`
   corridor-intel task, and a `campaign` proposal task linked to both.
3. `performance` and `campaign` run in parallel; the third stays `todo` until both parents are
   `done`, then the dispatcher promotes it to `ready`.
4. Each worker appends findings as comments.
5. `campaign` spawns, reads the comment thread, calls `get_context_pack`, and emits
   `create_proposal('campaign.budget_change', …)`.
6. The proposal appears in the admin approvals queue. A human decides. The undo window applies.

Note what did not happen: no agent changed a budget, and no agent needed another agent's memory.

---

## 8. What agents must never do

Enforced by the tool surface, not by prompt text:

- Execute against Google Ads or Meta. Only the existing executor does, after human approval.
- Send any message on any channel.
- Read across tenants.
- Write to domain tables directly.
- Approve their own proposals, or any proposal.
- Run analytical scans against the OLTP primary — `performance` uses the ClickHouse mirror.

---

## 9. Verification

Each agent gets one runnable check before it is considered working, in the spirit of the smallest
thing that fails if the logic breaks:

- **Tenant isolation test.** Spawn a worker with tenant A's token, attempt `get_enquiry` on a
  tenant B enquiry id, assert it returns not-found rather than data. This is the test that must
  never be skipped.
- **Evidence enforcement test.** Call `create_proposal` with an empty `evidence` array, assert
  rejection.
- **Read-only graph test.** Submit a mutating Cypher statement to `graph_query`, assert rejection.
- **Proposal round-trip test.** An agent proposal appears in the approvals queue with its rationale
  and evidence intact, and executes only after human approval.

---

## 10. Sequencing

> **Canonical order lives in `2026-08-12-build-sequence.md`** (added 2026-08-12). Stages here map
> as: Stage 1 → **S9**, Stage 2 → **S10**, Stage 3 → **S12**, Stage 4 → **S14**, Stage 5 → **S16**.
> Nothing in this document starts before **S3** (tenancy), because the entire safety model rests on
> row-level security. Where the two disagree, the build sequence wins.

**Stage 1 — Context server, no agents.** Build the MCP server with the read tools,
`create_proposal`, task-token tenant binding, and the four tests in §9. Verify by calling it
directly. This is the whole safety model; it is worth proving before an agent exists.

**Stage 2 — One agent: `leads`.** Single profile, no kanban, no orchestrator. It reads enquiries
and proposes requirement updates and message drafts. Enough to learn whether the tool surface is
right before multiplying it by six.

**Stage 3 — Kanban and `orchestrator`.** Add the board, task conventions, and dispatcher tenant
binding. Now two agents coordinate.

**Stage 4 — `performance` and `campaign`.** Requires the ClickHouse mirror (Phase D of the
datastore spec) and the pre-flight checks engine (E2 of the backend spec).

**Stage 5 — `research`, then `content`.** `content` is blocked on CMS features H1–H7.

Stage 1 depends on Phase B (tenancy) of the datastore spec. Nothing here should start before RLS
is in place, because the entire safety model rests on it.

---

## 11. Risks

**Six agents is five more than needed on day one.** The roster is specced in full because the
tool surface and tenant model must accommodate it, but building all six before one has earned its
keep would be waste. Hence AG7 and the staging above.

**Hermes is single-host.** *"It's your box, your filesystem, the worker runs with your uid…
single-host by design."* Profiles do not sandbox and can reach files outside their directory.
Acceptable for internal automation; blocks broker-facing agents.

**Kanban `--tenant` is a soft filter.** The docs are explicit that *"boards are the hard isolation
boundary."* Our hard boundary is RLS at the storage layer, not kanban. If a future workload needs
hard isolation at the queue level, use a board per tenant rather than the tenant namespace.

**Agent memory drift.** Each profile accumulates its own memory. Two agents can form different
beliefs about the same broker. The context server is the shared source of truth; agents should be
prompted to prefer it over recollection, and memory should hold working preferences rather than
domain facts.

**Prompt injection via inbound content.** Enquiry text arrives from the public internet through the
website form and inbound email. An agent reading it is processing untrusted input. The proposal
gate limits blast radius to a bad suggestion, but `get_context_pack` and evidence enforcement
should be treated as the mitigation, and inbound text should be clearly delimited in prompts.

---

## 12. Open questions

1. **Task token format and lifetime** — signed JWT with the task TTL, or an opaque token in a
   server-side table? The latter is revocable.
2. **Model per profile** — one model for all six, or cheaper models for triage and stronger ones
   for proposals?
3. **Cost accounting** — agent token spend should meter into the existing `usage_ledger` per org,
   which means the MCP server needs to attribute usage. Worth confirming before Stage 2.
4. **Where the orchestrator's schedule lives** — Hermes cron per profile, or the existing
   `node-cron` in `ads-agent`? Two schedulers is a smell.
5. **Human review of agent proposals at volume** — if six agents propose freely, the approvals
   queue becomes the bottleneck the UX spec was designed to avoid. Needs a rate or quality gate.
