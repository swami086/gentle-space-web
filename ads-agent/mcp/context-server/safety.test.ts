// ads-agent/mcp/context-server/safety.test.ts
/**
 * The S9 gate. Agent spec §9: "Each agent gets one runnable check before it is
 * considered working." These four run against a live database with two orgs, by
 * calling the server directly — no agent exists yet, which is the point. This
 * whole safety model is worth proving before multiplying it by six agents.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Pool } from "pg";
import { buildContextMcpServer } from "./index";
import { mintTaskToken } from "./task-token";
import { closeAgentReadPool, getAgentReadPool, withAgentTenantWriteTx } from "./db";

const LIVE = Boolean(process.env.DATABASE_URL && process.env.AGENT_RO_DATABASE_URL);
const ORG_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const ORG_B = "bbbbbbbb-0000-0000-0000-00000000000b";
const ENQUIRY_A = "aaaaaaaa-1111-0000-0000-00000000000a";
const ENQUIRY_B = "bbbbbbbb-1111-0000-0000-00000000000b";

const ALL_TOOLS = [
  "search_spaces",
  "get_space",
  "list_enquiries",
  "get_enquiry",
  "get_campaign_performance",
  "list_proposals",
  "graph_query",
  "get_context_pack",
  "create_proposal",
];

const owner = LIVE ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

async function seed() {
  await owner!.query(
    `INSERT INTO public.orgs (id, name, kind, slug) VALUES
       ($1,'Safety A','external','safety-a'),
       ($2,'Safety B','external','safety-b')
     ON CONFLICT (id) DO NOTHING`,
    [ORG_A, ORG_B],
  );
  for (const [org, enquiry, name] of [
    [ORG_A, ENQUIRY_A, "Tenant A enquirer"],
    [ORG_B, ENQUIRY_B, "Tenant B enquirer"],
  ] as const) {
    await owner!.query("BEGIN");
    await owner!.query("SELECT public.set_tenant($1)", [org]);
    await owner!.query(
      `INSERT INTO adsagent.enquiries (id, org_id, contact_name, reply_state)
       VALUES ($1, $2, $3, 'waiting') ON CONFLICT (id) DO NOTHING`,
      [enquiry, org, name],
    );
    await owner!.query(
      `INSERT INTO context.graph_manifests (org_id, status, last_built_at, cdc_lag_seconds)
       VALUES ($1, 'ready', now(), 5)
       ON CONFLICT (org_id) DO UPDATE SET cdc_lag_seconds = 5, last_built_at = now()`,
      [org],
    );
    await owner!.query("COMMIT");
  }
}

async function client() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildContextMcpServer();
  const c = new Client({ name: "safety", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), c.connect(clientTransport)]);
  return c;
}

function payload(result: unknown): unknown {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content[0].text);
}

let tokenA = "";

beforeAll(async () => {
  if (!LIVE) return;
  await seed();
  tokenA = (
    await mintTaskToken({
      orgId: ORG_A,
      taskId: "safety-task",
      profile: "leads",
      toolAllowlist: ALL_TOOLS,
      ttlSeconds: 600,
    })
  ).token;
});

afterAll(async () => {
  await owner?.end();
  await closeAgentReadPool();
});

describe.skipIf(!LIVE)("S9 safety gate", () => {
  it("1. tenant isolation: tenant A's token cannot read a tenant B enquiry", async () => {
    const c = await client();
    const mine = payload(
      await c.callTool({ name: "get_enquiry", arguments: { task_token: tokenA, enquiry_id: ENQUIRY_A } }),
    );
    expect(mine).toMatchObject({ id: ENQUIRY_A });

    const theirs = payload(
      await c.callTool({ name: "get_enquiry", arguments: { task_token: tokenA, enquiry_id: ENQUIRY_B } }),
    );
    // Not-found, not a denial. A denial confirms the row exists.
    expect(theirs).toEqual({ error: "not_found" });
    expect(JSON.stringify(theirs)).not.toContain("Tenant B enquirer");
    await c.close();
  });

  it("2. evidence enforcement: create_proposal with an empty evidence array is rejected", async () => {
    const c = await client();
    const result = await c.callTool({
      name: "create_proposal",
      arguments: {
        task_token: tokenA,
        kind: "enquiry.requirement_update",
        payload: { desks: 40 },
        rationale: "No citation offered.",
        evidence: [],
      },
    });
    expect((result.isError ?? false) || JSON.stringify(payload(result)).includes("evidence")).toBe(true);

    // And the database refuses it independently of the tool layer.
    await expect(
      withAgentTenantWriteTx(ORG_A, (tx) =>
        tx.query(
          `SELECT adsagent.agent_create_proposal($1, $2::jsonb, $3, $4::text[], $5, $6)`,
          ["enquiry.requirement_update", "{}", "x", [], "leads", 5],
        ),
      ),
    ).rejects.toThrow(/evidence must not be empty/);
    await c.close();
  });

  it("3. read-only graph: a mutating Cypher statement submitted to graph_query is rejected", async () => {
    const c = await client();
    for (const statement of [
      "MATCH (n:Space) SET n.price_per_desk = 0 RETURN n",
      "MATCH (n) DETACH DELETE n",
      "CREATE (n:Space {name:'injected'}) RETURN n",
    ]) {
      const result = payload(
        await c.callTool({ name: "graph_query", arguments: { task_token: tokenA, template: statement, params: {} } }),
      );
      expect(result).toEqual({ error: "unknown_template" });
    }
    await c.close();
  });

  it("4. proposal round-trip: the proposal reaches the queue with rationale and evidence intact", async () => {
    const c = await client();
    const created = payload(
      await c.callTool({
        name: "create_proposal",
        arguments: {
          task_token: tokenA,
          kind: "enquiry.requirement_update",
          payload: { desks: 40 },
          rationale: "Asked for 40 desks on the second call.",
          evidence: [ENQUIRY_A],
        },
      }),
    ) as { proposalId: string };
    expect(created.proposalId).toMatch(/^[0-9a-f-]{36}$/);

    const listed = payload(
      await c.callTool({ name: "list_proposals", arguments: { task_token: tokenA, status: "pending" } }),
    ) as { id: string; rationale: string; evidence: string[]; status: string }[];
    const found = listed.find((p) => p.id === created.proposalId);
    expect(found?.rationale).toBe("Asked for 40 desks on the second call.");
    expect(found?.evidence).toEqual([ENQUIRY_A]);

    // It has NOT executed, and the server has no tool that could execute it.
    expect(found?.status).toBe("pending");
    const { rows } = await owner!.query<{ status: string; executed_at: Date | null; proposed_by: string }>(
      `SELECT status, executed_at, proposed_by FROM adsagent.proposals WHERE id = $1`,
      [created.proposalId],
    );
    expect(rows[0]).toMatchObject({ status: "pending", executed_at: null, proposed_by: "leads" });
    await c.close();
  });

  it("5. the server's own connection cannot write, even asking for read-write", async () => {
    const pool = getAgentReadPool();

    async function expectDenied(sql: string, params?: unknown[]) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SET TRANSACTION READ WRITE");
        await c.query("SELECT public.set_tenant($1)", [ORG_A]);
        await expect(c.query(sql, params)).rejects.toThrow(/permission denied/);
      } finally {
        await c.query("ROLLBACK").catch(() => {});
        c.release();
      }
    }

    await expectDenied(
      `INSERT INTO adsagent.proposals (org_id, kind, payload, triggered_rule)
       VALUES ($1,'pause','{}'::jsonb,'direct')`,
      [ORG_A],
    );
    await expectDenied(`UPDATE adsagent.proposals SET status = 'approved' WHERE org_id = $1`, [ORG_A]);
    // listings.* has no grant — agent_ro reads spaces only through SECURITY DEFINER scan.
    await expectDenied(`SELECT * FROM listings.listings LIMIT 1`);
  });

  it("6. cross-tenant reads fail on a reused pooled connection", async () => {
    const tokenB = (
      await mintTaskToken({
        orgId: ORG_B,
        taskId: "safety-task-b",
        profile: "leads",
        toolAllowlist: ALL_TOOLS,
        ttlSeconds: 600,
      })
    ).token;
    const c = await client();
    await c.callTool({ name: "get_enquiry", arguments: { task_token: tokenB, enquiry_id: ENQUIRY_B } });
    // Same physical connection, next request, tenant A: must not see B's row.
    const after = payload(
      await c.callTool({ name: "get_enquiry", arguments: { task_token: tokenA, enquiry_id: ENQUIRY_B } }),
    );
    expect(after).toEqual({ error: "not_found" });
    await c.close();
  });
});
