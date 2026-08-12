import { createServer } from "node:http";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import {
  hostHeaderValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { z } from "zod";
import { getContextPack, PACK_ENTITIES } from "./context-pack";
import { AGENT_PROPOSAL_KINDS, createAgentProposal } from "./create-proposal";
import { describeGraphTemplates, runGraphQuery } from "./graph-query";
import { getEnquiry, listEnquiries, REPLY_STATES } from "./read-enquiries";
import { getCampaignPerformance } from "./read-performance";
import { AGENT_VISIBLE_PROPOSAL_STATUSES, listProposals } from "./read-proposals";
import { getSpace, searchSpaces } from "./read-spaces";
import { otlpSpanSink } from "../../lib/tracing/otlp-sink";
import type { TaskTokenClaims } from "./task-token";
import { dispatchTool, setSpanSink } from "./tool-context";

export {
  bufferSpanSink,
  dispatchTool,
  getSpanSink,
  setSpanSink,
  type SpanRecord,
  type SpanSink,
} from "./tool-context";

export const CONTEXT_READ_TOOL_NAMES = [
  "search_spaces",
  "get_space",
  "list_enquiries",
  "get_enquiry",
  "get_campaign_performance",
  "list_proposals",
  "graph_query",
  "get_context_pack",
] as const;

/** Exactly one. Agents propose, humans dispose (agent spec AG1, §3). */
export const CONTEXT_WRITE_TOOL_NAMES = ["create_proposal"] as const;

const hexUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const TASK_TOKEN_FIELD = {
  task_token: z
    .string()
    .describe("Task token issued by the dispatcher. The tenant is derived from it."),
};

/** Wrong tenant and nonexistent are the same answer: a denial confirms the row exists. */
const NOT_FOUND = { content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found" }) }] };

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

/**
 * The only function in this file that calls server.registerTool. Every tool
 * therefore passes through dispatchTool, which is where token verification, the
 * tool allowlist, the cost ceiling and span emission live. A tool registered
 * around this helper would bypass all four, so index.test.ts asserts
 * server.registerTool appears exactly once in this file.
 */
function registerGuardedTool(
  server: McpServer,
  name: string,
  description: string,
  shape: z.ZodRawShape,
  run: (claims: TaskTokenClaims, args: Record<string, unknown>) => Promise<unknown>,
): void {
  server.registerTool(
    name,
    { description, inputSchema: z.object({ ...TASK_TOKEN_FIELD, ...shape }) },
    async (args: { task_token: string } & Record<string, unknown>) => {
      const { task_token: token, ...rest } = args;
      try {
        const value = await dispatchTool(name, token, (claims) => run(claims, rest));
        return value === null ? NOT_FOUND : json(value);
      } catch (err) {
        const code = (err as { code?: unknown }).code;
        return json({ error: typeof code === "string" ? code : "tool_error" });
      }
    },
  );
}

export function buildContextMcpServer(): McpServer {
  const server = new McpServer({ name: "context-mcp", version: "1.0.0" });

  registerGuardedTool(
    server,
    "search_spaces",
    "Rank spaces in this tenant against a natural-language query, with optional corridor, desk and price filters",
    {
      query: z.string().min(1).max(500),
      filters: z
        .object({
          corridor: z.string().min(1).max(120).optional(),
          minDesks: z.number().int().min(0).optional(),
          maxDesks: z.number().int().min(1).optional(),
          maxPricePerDesk: z.number().min(0).optional(),
        })
        .optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    (claims, args) => searchSpaces(claims, args),
  );

  registerGuardedTool(
    server,
    "get_space",
    "One space in this tenant with pricing, capacity and amenities",
    { space_id: hexUuid },
    (claims, args) => getSpace(claims, args.space_id),
  );

  registerGuardedTool(
    server,
    "list_enquiries",
    "Enquiry summaries for this tenant, newest activity first",
    {
      status: z.enum(REPLY_STATES).optional(),
      since: z.string().datetime().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    (claims, args) => listEnquiries(claims, args),
  );

  registerGuardedTool(
    server,
    "get_enquiry",
    "One enquiry in this tenant with its activity and derived signals",
    { enquiry_id: hexUuid },
    (claims, args) => getEnquiry(claims, args.enquiry_id),
  );

  registerGuardedTool(
    server,
    "get_campaign_performance",
    "Campaign spend, clicks, impressions and conversions from the ClickHouse mirror",
    { window_days: z.number().int().min(1).max(90), corridor: z.string().min(1).max(120).optional() },
    (claims, args) =>
      getCampaignPerformance(claims, { windowDays: args.window_days, corridor: args.corridor }),
  );

  registerGuardedTool(
    server,
    "list_proposals",
    "Proposals in this tenant, filtered by status",
    {
      status: z.enum(AGENT_VISIBLE_PROPOSAL_STATUSES).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    (claims, args) => listProposals(claims, args),
  );

  registerGuardedTool(
    server,
    "graph_query",
    `Run one named traversal template against this tenant's graph. Templates: ${describeGraphTemplates()
      .map((t) => `${t.name}(${t.params.join(", ")}) — ${t.description}`)
      .join("; ")}. Query text is not accepted.`,
    { template: z.string().min(1).max(64), params: z.record(z.string(), z.unknown()) },
    (claims, args) => runGraphQuery(claims, { template: args.template, params: args.params }),
  );

  registerGuardedTool(
    server,
    "get_context_pack",
    "The grounding allowlist for one entity: exactly the facts that may be cited, with built_at, CDC lag and the row ids drawn on",
    { entity: z.enum(PACK_ENTITIES), id: hexUuid },
    (claims, args) => getContextPack(claims, args),
  );

  registerGuardedTool(
    server,
    "create_proposal",
    "The only write tool. Creates a pending proposal for human approval. Evidence must be identifiers from a context pack, never prose, and must not be empty.",
    {
      kind: z.enum(AGENT_PROPOSAL_KINDS),
      payload: z.record(z.string(), z.unknown()),
      rationale: z.string().min(1).max(2000),
      evidence: z.array(z.string()).min(1).max(50),
    },
    (claims, args) => createAgentProposal(claims, args),
  );

  return server;
}

/** Host-header allowlist for the DNS-rebinding guard, matching google-ads-server. */
export function resolveContextMcpAllowedHosts(): string[] {
  const raw = process.env.CONTEXT_MCP_ALLOWED_HOSTS;
  if (!raw) return ["localhost", "127.0.0.1"];
  return raw
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}

export function resolveContextMcpBind(): string {
  const raw = process.env.CONTEXT_MCP_BIND?.trim();
  return raw && raw.length > 0 ? raw : "localhost";
}

/**
 * createMcpHandler is a stateless per-request factory. A single long-lived
 * transport rejects the second initialize with "Server already initialized",
 * and every client here opens a fresh session per call.
 */
export async function startContextMcpServer(port = 8768): Promise<void> {
  // Spans go to Langfuse over OTLP/HTTP. A missing LANGFUSE_OTLP_ENDPOINT makes
  // the sink a no-op rather than an error, so the server runs locally without it.
  setSpanSink(otlpSpanSink("context-mcp"));

  const handler = createMcpHandler(() => buildContextMcpServer());
  const nodeHandler = toNodeHandler(handler);
  const validateHost = hostHeaderValidation(resolveContextMcpAllowedHosts());
  const validateOrigin = localhostOriginValidation();
  const bind = resolveContextMcpBind();

  createServer((req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    if (req.url !== "/mcp" && !req.url?.startsWith("/mcp?")) {
      res.writeHead(404).end();
      return;
    }
    void nodeHandler(req, res);
  }).listen(port, bind, () => {
    console.log(`context-mcp listening on http://${bind}:${port}/mcp`);
  });
}
