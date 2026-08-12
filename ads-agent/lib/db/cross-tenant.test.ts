import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { getPool } from "./client";
import type { Scope } from "./scope-sql";
import { ORG_A, ORG_B, ORG_I, USER_A, seedTenants } from "./fixtures/tenants";
import {
  createCampaignRecord,
  getCampaignById,
  listCampaigns,
  markCampaignActive,
  updateCampaignBudget,
  updateCampaignStatus,
} from "./campaigns";
import {
  createProposal,
  decideProposal,
  getProposalById,
  listProposals,
  markProposalExecuted,
  markProposalFailed,
  updateProposalPayload,
} from "./proposals";
import {
  appendDraftMessage,
  createDraft,
  getDraftById,
  listDraftMessages,
  markDraftConverted,
  setDraftStatus,
  updateDraftFields,
} from "./campaign-drafts";
import {
  latestCrmSignalSnapshot,
  recentPerformanceSnapshots,
  recordCrmSignalSnapshot,
  recordPerformanceSnapshot,
} from "./snapshots";
import { getOverviewStats, getSpendCplTrend, listCampaignsWithLatestCpl } from "./dashboard";
import { getOrgSettings, setCronEnabled, touchLastRunAt } from "./org-settings";
import {
  getSpendByFeature,
  getSpendByModel,
  getSpendTrend,
  listMemberBalances,
  listOrgBalances,
} from "./credits";
import { countAuditToday, listAudit, writeAudit } from "./audit-log";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const A: Scope = { kind: "org", orgId: ORG_A };
const B: Scope = { kind: "org", orgId: ORG_B };
const PLATFORM: Scope = { kind: "platform", orgId: ORG_I };

let campaignA: string;
let proposalA: string;
let draftA: string;

beforeAll(async () => {
  if (!url) return;
  process.env.DATABASE_URL = url;
  await seedTenants();
  const campaign = await createCampaignRecord(A, {
    platform: "google",
    name: "A's campaign",
    dailyBudget: 700,
    corridor: "HSR",
  });
  campaignA = campaign.id;
  const proposal = await createProposal(A, {
    kind: "pause",
    campaignId: campaignA,
    payload: { campaignId: campaignA },
    triggeredRule: "kill_rule",
  });
  proposalA = proposal.id;
  draftA = (await createDraft(A)).id;
});

afterAll(async () => {
  if (url) await getPool().end();
});

suite("org B cannot read org A's rows", () => {
  it("getCampaignById", async () => {
    await expect(getCampaignById(B, campaignA)).resolves.toBeNull();
  });
  it("listCampaigns", async () => {
    const rows = await listCampaigns(B);
    expect(rows.map((r) => r.id)).not.toContain(campaignA);
  });
  it("getProposalById", async () => {
    await expect(getProposalById(B, proposalA)).resolves.toBeNull();
  });
  it("listProposals", async () => {
    const rows = await listProposals(B);
    expect(rows.map((r) => r.id)).not.toContain(proposalA);
  });
  it("getDraftById", async () => {
    await expect(getDraftById(B, draftA)).resolves.toBeNull();
  });
  it("listDraftMessages", async () => {
    await expect(listDraftMessages(B, draftA)).resolves.toEqual([]);
  });
  it("recentPerformanceSnapshots", async () => {
    await recordPerformanceSnapshot(A, {
      campaignId: campaignA,
      spend: 100,
      clicks: 5,
      impressions: 90,
      conversions: 1,
    });
    const rows = await recentPerformanceSnapshots(B, 30);
    expect(rows.filter((r) => r.campaignId === campaignA)).toEqual([]);
  });
  it("latestCrmSignalSnapshot", async () => {
    await recordCrmSignalSnapshot(A, {
      campaignId: campaignA,
      hotCount: 9,
      warmCount: 0,
      coldCount: 0,
      unscoredCount: 0,
    });
    const snap = await latestCrmSignalSnapshot(B);
    expect(snap?.hotCount ?? 0).not.toBe(9);
  });
  it("getOverviewStats counts only B's rows", async () => {
    const stats = await getOverviewStats(B);
    expect(stats.activeCampaignCount).toBe(0);
    expect(stats.pendingProposalCount).toBe(0);
  });
  it("listCampaignsWithLatestCpl", async () => {
    const rows = await listCampaignsWithLatestCpl(B);
    expect(rows.map((r) => r.id)).not.toContain(campaignA);
  });
  it("getSpendCplTrend", async () => {
    await expect(getSpendCplTrend(B, 30)).resolves.toEqual([]);
  });
  it("getOrgSettings falls back to defaults rather than reading A's row", async () => {
    await setCronEnabled(A, true);
    const settings = await getOrgSettings(B);
    expect(settings.cronEnabled).toBe(false);
  });
  it("listMemberBalances", async () => {
    const rows = await listMemberBalances(B);
    expect(rows.map((r) => r.userId)).not.toContain(USER_A);
  });
  it("getSpendByFeature / getSpendByModel / getSpendTrend", async () => {
    await expect(getSpendByFeature(B, 30)).resolves.toEqual([]);
    await expect(getSpendByModel(B, 30)).resolves.toEqual([]);
    await expect(getSpendTrend(B, 30)).resolves.toEqual([]);
  });
  it("listAudit / countAuditToday", async () => {
    await writeAudit(A, {
      actorType: "human",
      actorUserId: USER_A,
      action: "proposal.created",
      entityType: "proposal",
    });
    await expect(listAudit(B, 10)).resolves.toEqual([]);
    await expect(countAuditToday(B)).resolves.toBe(0);
  });
});

suite("org B cannot write org A's rows", () => {
  it("decideProposal affects nothing", async () => {
    await decideProposal(B, proposalA, "approved", USER_A, "api");
    const still = await getProposalById(A, proposalA);
    expect(still?.status).toBe("pending");
  });
  it("markProposalExecuted affects nothing", async () => {
    await markProposalExecuted(B, proposalA);
    expect((await getProposalById(A, proposalA))?.status).toBe("pending");
  });
  it("markProposalFailed affects nothing", async () => {
    await markProposalFailed(B, proposalA, "nope");
    expect((await getProposalById(A, proposalA))?.error).toBeNull();
  });
  it("updateProposalPayload throws rather than silently succeeding", async () => {
    await expect(updateProposalPayload(B, proposalA, { x: 1 })).rejects.toThrow("not found");
  });
  it("updateDraftFields throws", async () => {
    await expect(updateDraftFields(B, draftA, { corridor: "stolen" })).rejects.toThrow("not found");
  });
  it("setDraftStatus affects nothing", async () => {
    await setDraftStatus(B, draftA, "ready");
    expect((await getDraftById(A, draftA))?.status).toBe("chatting");
  });
  it("markDraftConverted affects nothing", async () => {
    await markDraftConverted(B, draftA, proposalA);
    expect((await getDraftById(A, draftA))?.proposalId).toBeNull();
  });
  it("appendDraftMessage throws", async () => {
    await expect(appendDraftMessage(B, draftA, "user", "hi")).rejects.toThrow("not found");
  });
  it("recordPerformanceSnapshot throws for A's campaign", async () => {
    await expect(
      recordPerformanceSnapshot(B, {
        campaignId: campaignA,
        spend: 1,
        clicks: 1,
        impressions: 1,
        conversions: 1,
      }),
    ).rejects.toThrow("not found");
  });
  it("touchLastRunAt affects nothing", async () => {
    const before = (await getOrgSettings(A)).lastRunAt;
    await touchLastRunAt(B);
    expect((await getOrgSettings(A)).lastRunAt).toBe(before);
  });
  it("markCampaignActive affects nothing", async () => {
    await markCampaignActive(B, campaignA, "ext-1");
    expect((await getCampaignById(A, campaignA))?.status).not.toBe("active");
  });
  it("updateCampaignBudget affects nothing", async () => {
    const before = (await getCampaignById(A, campaignA))?.dailyBudget;
    await updateCampaignBudget(B, campaignA, 9999);
    expect((await getCampaignById(A, campaignA))?.dailyBudget).toBe(before);
  });
  it("updateCampaignStatus affects nothing", async () => {
    await updateCampaignStatus(B, campaignA, "paused");
    expect((await getCampaignById(A, campaignA))?.status).not.toBe("paused");
  });
});

suite("platform scope reads across orgs but never writes across them", () => {
  it("reads both orgs' campaigns", async () => {
    const rows = await listCampaigns(PLATFORM);
    expect(rows.map((r) => r.id)).toContain(campaignA);
  });
  it("reads a specific org's proposal", async () => {
    await expect(getProposalById(PLATFORM, proposalA)).resolves.not.toBeNull();
  });
  it("listOrgBalances works only under platform scope", async () => {
    await expect(listOrgBalances(PLATFORM)).resolves.toBeInstanceOf(Array);
    await expect(listOrgBalances(A)).rejects.toThrow("requires platform scope");
  });
  it("a platform INSERT carrying another org's org_id is rejected by WITH CHECK", async () => {
    // WITH CHECK pins writes to current_tenant() even under platform scope, so
    // the read affordance cannot become a write bypass.
    await expect(
      (async () => {
        const { withTenantTransaction } = await import("./tx");
        await withTenantTransaction(PLATFORM, async (client) => {
          await client.query("SET ROLE adsagent_rw");
          return client.query(
            `INSERT INTO adsagent.campaigns (org_id, platform, name)
             VALUES ($1::uuid, 'google', 'smuggled')`,
            [ORG_A],
          );
        });
      })(),
    ).rejects.toThrow(/row-level security/i);
  });
});

suite("the pooled-connection case — the release gate", () => {
  it("a second request on a reused connection cannot see the first's tenant", async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      const first = await pool.connect();
      await first.query("SET ROLE adsagent_rw");
      const pidA = (await first.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await first.query("BEGIN");
      await first.query("SELECT public.set_tenant($1)", [ORG_A]);
      const seen = await first.query<{ n: string }>(
        `SELECT count(*) AS n FROM adsagent.campaigns WHERE id = $1`,
        [campaignA],
      );
      expect(Number(seen.rows[0].n)).toBe(1);
      await first.query("COMMIT");
      first.release();

      const second = await pool.connect();
      await second.query("SET ROLE adsagent_rw");
      const pidB = (await second.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      expect(pidB, "same physical connection is the whole point").toBe(pidA);
      await second.query("BEGIN");
      await second.query("SELECT public.set_tenant($1)", [ORG_B]);
      const leaked = await second.query<{ n: string }>(
        `SELECT count(*) AS n FROM adsagent.campaigns WHERE id = $1`,
        [campaignA],
      );
      await second.query("COMMIT");
      second.release();
      expect(Number(leaked.rows[0].n), "org A's row visible to org B on a reused connection").toBe(0);
    } finally {
      await pool.end();
    }
  });

  it("a request with no tenant set sees nothing — fail closed", async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      const client = await pool.connect();
      await client.query("SET ROLE adsagent_rw");
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM adsagent.campaigns`,
      );
      client.release();
      expect(Number(rows[0].n), "no tenant set must mean no rows, not all rows").toBe(0);
    } finally {
      await pool.end();
    }
  });
});

suite("coverage meta-test", () => {
  it("every exported data-layer function has a cross-tenant case", async () => {
    const modules = {
      "./campaigns": await import("./campaigns"),
      "./proposals": await import("./proposals"),
      "./campaign-drafts": await import("./campaign-drafts"),
      "./snapshots": await import("./snapshots"),
      "./dashboard": await import("./dashboard"),
      "./org-settings": await import("./org-settings"),
      "./credits": await import("./credits"),
      "./audit-log": await import("./audit-log"),
    };
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(__filename, "utf8");

    const uncovered: string[] = [];
    for (const [path, mod] of Object.entries(modules)) {
      for (const [name, value] of Object.entries(mod)) {
        if (typeof value !== "function") continue;
        if (name === "ensureOrgSettings") continue; // exercised by dal, not a read path
        if (!source.includes(`${name}(`)) uncovered.push(`${path}:${name}`);
      }
    }
    // A new scoped function with no case fails here, on the day it lands.
    expect(uncovered).toEqual([]);
  });
});
