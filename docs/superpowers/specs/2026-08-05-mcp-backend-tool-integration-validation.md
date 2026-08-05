# MCP-only backend tool integration — validation findings

**Date:** 2026-08-05
**Method:** `/firecrawl-cli` research against official/primary sources (`modelcontextprotocol.io`, `docs.getbifrost.ai`, `github.com/modelcontextprotocol/typescript-sdk`, `docs.twenty.com`, `npmjs.com/package/supergateway`), plus `torbit mcp` for codebase grounding. Raw search/scrape output saved under `.firecrawl/*.json`/`.firecrawl/*.md` (gitignored).
**Verdict:** The plan's vendor choices (community Twenty MCP server, `supergateway` sidecar) hold up. Two corrections are required — one transport bug, one architecture simplification that directly serves the "limit custom code, use standardised interfaces" instruction. Both are applied to the design spec and implementation plan in the same commit as this file.

## 1. Correction: transport must be Streamable HTTP, not SSE (bug fix)

**Finding:** The MCP specification deprecated HTTP+SSE in favor of Streamable HTTP in the 2025-03-26 revision, and the current spec (2026-07-28) keeps Streamable HTTP as the standard remote transport — SSE-only servers are treated as **legacy/back-compat only**, not the default path. ([modelcontextprotocol.io/specification/2025-03-26/basic/transports](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports); confirmed by three independent secondary sources: Auth0, BrightData, fka.dev.)

The original plan's Task 1 configured `supergateway --outputTransport sse` and Bifrost's `connection_type: "sse"` — the deprecated transport. Bifrost's own docs use the connection-type name `"http"` for Streamable HTTP (its example URLs consistently end in `/mcp`, the Streamable HTTP convention) and reserve `"sse"` for the legacy transport (example URLs end in `/sse`) — confirmed against Bifrost's `mcp/connecting-to-servers` doc content cached from this session. `supergateway`'s own README lists **stdio → Streamable HTTP as its primary documented mode** (`--outputTransport streamableHttp`, endpoint defaults to `/mcp`), confirming it's not an edge case.

**Fix applied:** `--outputTransport streamableHttp` (not `sse`) in Task 1's docker-compose service; endpoint becomes `http://twenty-mcp-gateway:8765/mcp`, not `.../sse`.

## 2. Simplification: bypass Bifrost's MCP Gateway feature, use the official MCP SDK directly

This is the substantive answer to "limit custom code/connectors/implementation where possible and use standardised interfaces."

**What the original plan did:** Registered `twenty-mcp-gateway` as an MCP client *inside Bifrost's config* (`bifrost/config.json`'s `mcp.client_configs`), relying on Bifrost to auto-discover the server's tool schemas, inject them into chat completions (gated by `disable_auto_tool_inject` + a custom `x-bf-mcp-include-tools` header), and execute resolved tool calls via Bifrost's proprietary `POST /v1/mcp/tool/execute` endpoint. Task 1 Step 4 even required a live `curl` just to *discover* Bifrost's internal tool-naming convention (`<client>_<tool>`, underscore-joined) before the rest of the plan could proceed — a sign the app was coupling itself to undocumented Bifrost-internal behavior, not a standardised interface.

**What research found instead:** The Model Context Protocol has an official, Anthropic-maintained TypeScript SDK — `@modelcontextprotocol/client` (v2, current as of the 2026-07-28 spec; previously the unified `@modelcontextprotocol/sdk` package) — whose entire purpose is exactly this: connect to one MCP server and call its tools, with no gateway in between. ([github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk), `docs/get-started/first-client.md`, `docs/clients/connect.md`.) The documented usage is three primitives:

```typescript
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const client = new Client({ name: "ads-agent", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("http://twenty-mcp-gateway:8765/mcp")));

const { tools } = await client.listTools();          // JSON Schema, ready to hand an LLM tools param verbatim
const result = await client.callTool({ name: "list_opportunities", arguments: { limit: 200 } });

await client.close();
```

The SDK's own docs state the punchline directly: *"each [tool] entry's `name`, `description`, and `inputSchema` — plain JSON Schema — map one-to-one onto the tool definition every tool-calling LLM API takes."* That means our own code can call `listTools()` once and hand the result straight to Bifrost's (OpenAI-compatible) `tools` parameter — no hand-maintained duplicate tool-schema declarations, and no dependency on Bifrost's own MCP-discovery/injection machinery at all.

**Why this is the better design, concretely:**

| | Original plan (Bifrost MCP Gateway) | Revised (official MCP SDK direct) |
|---|---|---|
| Bifrost config | New `mcp` section, `disable_auto_tool_inject`, `client_configs` | None — Bifrost stays a plain OpenAI-compatible chat endpoint |
| Custom headers | `x-bf-mcp-include-tools` (Bifrost-proprietary, undocumented naming format required a live curl to discover) | None |
| Tool execution call | Bifrost's proprietary `POST /v1/mcp/tool/execute` | Standard MCP `client.callTool()` |
| Tool schema source | Bifrost auto-discovery (opaque) | Our own `client.listTools()` (explicit, inspectable, always in sync with the live server) |
| Mutation safety | Header-based allowlist (a denylist Bifrost must apply correctly) + a post-hoc name filter | The `tools` array we build and pass to the model literally never contains `update_opportunity`'s schema — the model cannot request what it was never told exists. The post-hoc name filter stays as defense-in-depth against hallucinated tool names. |
| Portability | Coupled to Bifrost's MCP Gateway feature specifically | Works with any OpenAI-compatible chat endpoint; MCP connection is a separate, swappable concern |
| New dependency | None (uses Bifrost's existing REST surface) | `@modelcontextprotocol/client` (official, maintained by the MCP org itself — not "custom" code) |

The one new dependency (`@modelcontextprotocol/client`) is the trade *for* removing more custom code than it adds: the entire `mcp` config block, the header-allowlist mechanism, and the live-discovery step in Task 1 all disappear. `lib/bifrost/mcp-client.ts` (Task 2) still exists, but its ~50 lines of hand-rolled `fetch()`-against-an-undocumented-endpoint shrink to a thin wrapper around three official SDK calls (`connect`/`listTools`/`callTool`) — this is "use standardised interfaces" in its most literal sense.

**Net effect on the plan:** Task 1 drops its `bifrost/config.json` step and its tool-naming-discovery curl step entirely (simpler, not just corrected). Task 2 is rewritten around the SDK instead of raw `fetch`. Task 3's `headers` field on `ChatCompletionOptions` is replaced by a standard `tools`/`tool_choice` field (which is *more* standard, since it's the same `tools` param every OpenAI-compatible API already accepts — not a Bifrost-specific header). Task 6 fetches live schemas via `listTools()` instead of hardcoding an allowlist header string. Tasks 5, 7, 8, 9 are unaffected at the call-site level (same function signatures, same system-prompt changes, same test shape) — full details in the updated plan and spec.

## 3. Re-confirmed, no change needed

- **Twenty native MCP is still Cloud-only.** `twenty.com` ("Every Cloud workspace ships with a native MCP server... via OAuth") and `docs.twenty.com/developers/self-host/self-host` (scraped in full, zero mentions of MCP) both confirm this as of today. The community server + self-hosted bridge remains the only path for our self-hosted Twenty instance — no simplification available here, even with Twenty's 2026 "v2.0" self-host rewrite.
- **`supergateway` is still active and fit for purpose** (v3.3+, explicit "fully concurrent stdio to SSE and Streamable HTTP" release notes) and is the simplest bridge for our stack (npm-based, matches the rest of `ads-agent`'s Node tooling — no need for the Python-based `sparfenyuk/mcp-proxy` alternative also found in research).
- **No dedicated Bifrost Node/TS SDK exists** (only a Go SDK, `github.com/maximhq/bifrost/core`) — so `lib/bifrost/client.ts`'s existing hand-rolled fetch wrapper around Bifrost's OpenAI-compatible REST API is already the right level of abstraction for the chat-completion side; not something this pass should try to replace.

## Sources

- https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- https://docs.getbifrost.ai/mcp/connecting-to-servers (connection_type "http" vs "sse" naming, cached this session)
- https://github.com/modelcontextprotocol/typescript-sdk (README, `docs/get-started/first-client.md`, `docs/clients/connect.md`)
- https://www.npmjs.com/package/supergateway
- https://docs.twenty.com/developers/self-host/self-host
- https://twenty.com/
- https://github.com/maximhq/bifrost
