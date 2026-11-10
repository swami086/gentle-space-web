import {
  createCampaignRecord,
  getCampaignById,
  markCampaignActive,
  updateCampaignBudget,
  updateCampaignStatus,
} from "../db/campaigns";
import { assertListingCreatePayload, getProposalById, markProposalExecuted, markProposalFailed } from "../db/proposals";
import type { Scope } from "../db/scope-sql";
import { withTenantTransaction } from "../db/tx";
import { requireEnv } from "../env";
import { listCurrent } from "../connections/store";
import {
  activateUnifiedCampaign,
  addUnifiedNegativeKeyword,
  createPausedUnifiedCampaign,
  pauseUnifiedCampaign,
  type UnifiedWriteMode,
  updateUnifiedCampaignBudget,
} from "../connectors/unified-sandbox";
import { reallocateListing } from "../monitor/reallocate";
import { renderOutbound, type OutboundMarket } from "../outbound/sender";
import { executableProposalKind } from "../proposals/normalize-kind";
import type { ListingCreatePayload, Platform } from "../types";

const PLATFORM_ORG_ID = "00000000-0000-0000-0000-000000000001";

type CreateCampaignPayload = {
  corridor: string;
  platform: Platform;
  dailyBudgetInr: number;
  geoTargetConstant: string;
  languageConstant: string;
  adGroupName: string;
  keywords: { text: string; matchType: "broad" | "phrase" | "exact" }[];
  negativeKeywords: string[];
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
};
type CampaignActionPayload = { campaignId: string };
type BudgetChangePayload = { campaignId: string; newDailyBudgetInr: number };
type NegativeKeywordPayload = { campaignId: string; keywordText: string };

export type ExecuteFaultPoint = "after_claim" | "after_partial" | "after_readback" | "after_switch";

export type ListingExecuteResult = {
  traceId: string;
  activated: boolean;
  google?: { campaignIds: number[] };
  meta?: { campaignId: string; formId: string; shares: { adSetId: string; adId: string }[] };
  sandbox?: { googleCampaignIds: string[]; metaCampaignIds: string[] };
};

export type ExecuteProposalResult = {
  status: "executed" | "failed";
  error?: string;
  result?: ListingExecuteResult;
};

class ExecuteFault extends Error {
  constructor(readonly faultAt: ExecuteFaultPoint) {
    super(`execute fault injected at ${faultAt}`);
    this.name = "ExecuteFault";
  }
}

function isListingCreatePayload(payload: Record<string, unknown>): boolean {
  if (typeof payload.corridor === "string" || typeof payload.dailyBudgetInr === "number") {
    return false;
  }
  return (
    typeof payload.traceId === "string" &&
    Array.isArray(payload.ceilings) &&
    Array.isArray(payload.shares)
  );
}

function isListingBudgetChangePayload(payload: Record<string, unknown>): boolean {
  return typeof payload.listingId === "string" && Array.isArray(payload.ceilings);
}

function assertNoEndDateUnifiedUpdate(payload: Record<string, unknown>): void {
  if (
    typeof payload.endTimeIso === "string" ||
    typeof payload.newEndTimeIso === "string" ||
    typeof payload.endDate === "string" ||
    typeof payload.newEndDate === "string" ||
    payload.endEarly === true
  ) {
    throw new Error("this phase's Unified update does not send an end date");
  }
}

type UnifiedConnectionRef = { connectionId: string; mode: UnifiedWriteMode; canActivate: boolean };

async function resolveUnifiedConnection(scope: Scope, platform: Platform): Promise<UnifiedConnectionRef> {
  if (scope.kind !== "org" || scope.orgId === PLATFORM_ORG_ID) {
    return {
      connectionId: requireEnv(
        platform === "google" ? "UNIFIED_GOOGLE_ADS_CONNECTION_ID" : "UNIFIED_META_ADS_CONNECTION_ID",
      ),
      mode: "test",
      canActivate: false,
    };
  }

  const connections = await listCurrent(scope);
  const row = connections.find((c) => c.platform === platform);
  if (!row) {
    throw new Error(`no current ${platform} connection for org ${scope.orgId}`);
  }
  if (row.externalAccountId === "stage0-pending") {
    throw new Error(`${platform} connection is stage0-pending, not a Unified connection id`);
  }
  if (row.allowlist.length > 0 && !row.allowlist.includes(row.externalAccountId)) {
    throw new Error(`${platform} connection is outside the allowlist`);
  }
  return {
    connectionId: row.externalAccountId,
    mode: row.environment === "live" ? "production" : "test",
    canActivate: row.canActivate,
  };
}

async function persistListingRows(scope: Scope, listing: ListingCreatePayload): Promise<string[]> {
  return withTenantTransaction(scope, async (client) => {
    let listingId = listing.listingId;
    if (!listingId) {
      if (!listing.market || !listing.sector || !listing.approverPhone) {
        throw new Error("listing create payload requires market, sector, and approverPhone");
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO adsagent.listings (org_id, approver_phone, market, sector, facts)
         VALUES ($1::uuid, $2, $3, $4, $5::jsonb)
         RETURNING id`,
        [
          scope.orgId,
          listing.approverPhone,
          listing.market,
          listing.sector,
          JSON.stringify({ goal: listing.goal ?? null }),
        ],
      );
      listingId = inserted.rows[0]?.id;
      if (!listingId) throw new Error("listing insert returned no row");
    }
    const shareIds: string[] = [];
    for (const ceiling of listing.ceilings) {
      await client.query(
        `INSERT INTO adsagent.listing_ceilings (listing_id, platform, ceiling_minor)
         VALUES ($1::uuid, $2, $3)
         ON CONFLICT (listing_id, platform) DO NOTHING`,
        [listingId, ceiling.platform, ceiling.ceilingMinor],
      );
    }
    for (const share of listing.shares) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO adsagent.listing_shares (listing_id, platform, budget_minor)
         VALUES ($1::uuid, $2, $3)
         RETURNING id`,
        [listingId, share.platform, share.budgetMinor],
      );
      const shareId = inserted.rows[0]?.id;
      if (!shareId) throw new Error("listing share insert returned no row");
      shareIds.push(shareId);
    }
    return shareIds;
  });
}

async function storeExternalCampaignIds(
  scope: Scope,
  shareIds: string[],
  externalIds: string[],
): Promise<void> {
  if (shareIds.length !== externalIds.length) {
    throw new Error("listing create share count does not match created campaigns");
  }
  await withTenantTransaction(scope, async (client) => {
    for (let i = 0; i < shareIds.length; i += 1) {
      await client.query(
        `UPDATE adsagent.listing_shares SET external_campaign_id = $2 WHERE id = $1::uuid`,
        [shareIds[i], externalIds[i]],
      );
    }
  });
}

type CreatedUnifiedCampaign = {
  connectionId: string;
  campaignId: string;
  mode: UnifiedWriteMode;
};

async function pauseCreatedCampaigns(created: CreatedUnifiedCampaign[]): Promise<void> {
  for (const item of created) {
    await pauseUnifiedCampaign(item.connectionId, item.campaignId, item.mode);
  }
}

async function executeListingOnUnifiedSandbox(
  scope: Scope,
  proposalId: string,
  listing: ListingCreatePayload,
): Promise<{ result: ListingExecuteResult; externalIds: string[]; created: CreatedUnifiedCampaign[] }> {
  const externalIds: string[] = [];
  const created: CreatedUnifiedCampaign[] = [];
  const googleCampaignIds: string[] = [];
  const metaCampaignIds: string[] = [];
  let activated = false;
  let googleIndex = 0;
  let metaIndex = 0;
  try {
  for (const share of listing.shares) {
    const connection = await resolveUnifiedConnection(scope, share.platform);
    const campaignId = await createPausedUnifiedCampaign(
      share.platform === "google"
        ? {
            connectionId: connection.connectionId,
            name: `${proposalId} google share ${(googleIndex += 1)}`,
            budgetAmount: share.budgetMinor / 100,
            budgetPeriod: "TOTAL",
            advertisingChannelType: "SEARCH",
          }
        : {
            connectionId: connection.connectionId,
            name: `${proposalId} meta share ${(metaIndex += 1)}`,
            budgetAmount: share.budgetMinor / 100,
            budgetPeriod: "LIFETIME",
            goal: "LEADS",
          },
      connection.mode,
    );
    externalIds.push(campaignId);
    created.push({
      connectionId: connection.connectionId,
      campaignId,
      mode: connection.mode,
    });
    if (share.platform === "google") googleCampaignIds.push(campaignId);
    else metaCampaignIds.push(campaignId);
    if (connection.mode === "production" && connection.canActivate) {
      await activateUnifiedCampaign(connection.connectionId, campaignId, {
        canActivate: true,
        mode: "production",
      });
      activated = true;
    }
  }
  return {
    result: {
      traceId: listing.traceId,
      activated,
      sandbox: { googleCampaignIds, metaCampaignIds },
    },
    externalIds,
    created,
  };
  } catch (err) {
    await pauseCreatedCampaigns(created);
    throw err;
  }
}

async function executeListingCreateCampaign(
  scope: Scope,
  proposalId: string,
  rawPayload: Record<string, unknown>,
  faultAt?: ExecuteFaultPoint,
): Promise<ListingExecuteResult> {
  const listing = assertListingCreatePayload(rawPayload);

  if (faultAt === "after_claim") {
    throw new ExecuteFault("after_claim");
  }

  if (!(await readWritesEnabled(scope))) {
    throw new Error("listing create is disabled while writes_enabled is false");
  }

  const shareIds = await persistListingRows(scope, listing);
  let created: Awaited<ReturnType<typeof executeListingOnUnifiedSandbox>> | undefined;
  try {
    created = await executeListingOnUnifiedSandbox(scope, proposalId, listing);
    await storeExternalCampaignIds(scope, shareIds, created.externalIds);
  } catch (err) {
    if (created) await pauseCreatedCampaigns(created.created);
    throw err;
  }
  return created.result;
}


async function requireCampaign(scope: Scope, campaignId: string) {
  const campaign = await getCampaignById(scope, campaignId);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);
  if (!campaign.externalId) throw new Error(`campaign ${campaignId} has no externalId yet`);
  return campaign;
}

async function executeCreateCampaign(scope: Scope, payload: CreateCampaignPayload): Promise<void> {
  const name = `${payload.corridor} — ${payload.platform} — ${new Date().toISOString().slice(0, 10)}`;
  const record = await createCampaignRecord(scope, {
    platform: payload.platform,
    name,
    dailyBudget: payload.dailyBudgetInr,
    corridor: payload.corridor,
  });
  const unified = await resolveUnifiedConnection(scope, payload.platform);
  const externalId = await createPausedUnifiedCampaign(
    {
      connectionId: unified.connectionId,
      name,
      budgetAmount: payload.dailyBudgetInr,
      budgetPeriod: "DAILY",
      ...(payload.platform === "google"
        ? { advertisingChannelType: "SEARCH" as const }
        : { goal: "WEBSITE_TRAFFIC" as const }),
    },
    unified.mode,
  );
  await markCampaignActive(scope, record.id, externalId);
}

async function executePause(scope: Scope, payload: CampaignActionPayload): Promise<void> {
  const campaign = await requireCampaign(scope, payload.campaignId);
  const unified = await resolveUnifiedConnection(scope, campaign.platform);
  await pauseUnifiedCampaign(unified.connectionId, campaign.externalId!, unified.mode);
  await updateCampaignStatus(scope, campaign.id, "paused");
}

function distributeEqualMinor(ceilingMinor: number, shareIds: string[]): Map<string, number> {
  if (shareIds.length === 0) return new Map();
  const recipients = shareIds.map((id) => ({ id, leads: 1 }));
  const poolMinor = ceilingMinor;
  const parts = recipients.map((r) => {
    const exact = poolMinor / recipients.length;
    const base = Math.floor(exact);
    return { id: r.id, base, fraction: exact - base };
  });
  let remainder = poolMinor - parts.reduce((sum, p) => sum + p.base, 0);
  const order = [...parts].sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id));
  const out = new Map<string, number>();
  for (const p of parts) {
    out.set(p.id, p.base);
  }
  for (let i = 0; remainder > 0; i += 1, remainder -= 1) {
    const target = order[i % order.length];
    out.set(target.id, (out.get(target.id) ?? 0) + 1);
  }
  return out;
}

type ListingShareRow = {
  id: string;
  platform: Platform;
  external_campaign_id: string | null;
  budget_minor: number;
  spend_minor: number;
  lead_count: number;
  last_share_move_on: string | null;
};

type ListingCeilingRow = {
  platform: Platform;
  ceiling_minor: number;
};

async function executeListingBudgetChange(
  scope: Scope,
  payload: Record<string, unknown>,
): Promise<void> {
  assertNoEndDateUnifiedUpdate(payload);
  const listingId = String(payload.listingId);
  const ceilingRows = (payload.ceilings as { platform?: unknown; ceilingMinor?: unknown }[]).map(
    (row, index) => {
      if (row.platform !== "meta" && row.platform !== "google") {
        throw new Error(`ceilings[${index}].platform must be meta or google`);
      }
      if (typeof row.ceilingMinor !== "number") {
        throw new Error(`ceilings[${index}].ceilingMinor must be a number`);
      }
      return { platform: row.platform as Platform, ceiling_minor: row.ceilingMinor };
    },
  );

  const { shares } = await withTenantTransaction(scope, async (client) => {
    const shareResult = await client.query<ListingShareRow>(
      `SELECT id, platform, external_campaign_id, budget_minor, spend_minor, lead_count, last_share_move_on
         FROM adsagent.listing_shares
        WHERE listing_id = $1::uuid
        ORDER BY id`,
      [listingId],
    );
    return { shares: shareResult.rows };
  });

  const newCeilingByPlatform = new Map(ceilingRows.map((c) => [c.platform, c.ceiling_minor]));

  for (const [platform, ceilingMinor] of newCeilingByPlatform) {
    const platformShares = shares.filter((s) => s.platform === platform);
    if (platformShares.length === 0) continue;
    const budgets = distributeEqualMinor(
      ceilingMinor,
      platformShares.map((s) => s.id),
    );
    for (const share of platformShares) {
      const nextMinor = budgets.get(share.id);
      if (nextMinor == null) continue;
      if (nextMinor < share.spend_minor) {
        throw new Error(
          `listing ceiling change would put share ${share.id} below spend (${nextMinor} < ${share.spend_minor})`,
        );
      }
    }

    for (const share of platformShares) {
      const nextMinor = budgets.get(share.id)!;
      if (!share.external_campaign_id) {
        throw new Error(`listing share ${share.id} has no external_campaign_id`);
      }
      const unified = await resolveUnifiedConnection(scope, platform);
      await updateUnifiedCampaignBudget(
        unified.connectionId,
        share.external_campaign_id,
        nextMinor / 100,
        unified.mode,
      );
    }

    await withTenantTransaction(scope, async (client) => {
      for (const share of platformShares) {
        const nextMinor = budgets.get(share.id)!;
        await client.query(
          `UPDATE adsagent.listing_shares SET budget_minor = $2 WHERE id = $1::uuid`,
          [share.id, nextMinor],
        );
      }
      await client.query(
        `UPDATE adsagent.listing_ceilings SET ceiling_minor = $2
          WHERE listing_id = $1::uuid AND platform = $3`,
        [listingId, ceilingMinor, platform],
      );
    });
  }
}

async function executeBudgetChange(scope: Scope, payload: Record<string, unknown>): Promise<void> {
  assertNoEndDateUnifiedUpdate(payload);
  if (isListingBudgetChangePayload(payload)) {
    await executeListingBudgetChange(scope, payload);
    return;
  }
  const corridorPayload = payload as unknown as BudgetChangePayload;
  const campaign = await requireCampaign(scope, corridorPayload.campaignId);
  const unified = await resolveUnifiedConnection(scope, campaign.platform);
  await updateUnifiedCampaignBudget(
    unified.connectionId,
    campaign.externalId!,
    corridorPayload.newDailyBudgetInr,
    unified.mode,
  );
  await updateCampaignBudget(scope, campaign.id, corridorPayload.newDailyBudgetInr);
}

async function executeAddNegativeKeyword(scope: Scope, payload: NegativeKeywordPayload): Promise<void> {
  const campaign = await requireCampaign(scope, payload.campaignId);
  if (campaign.platform !== "google") {
    throw new Error("add_negative_keyword is only implemented for Google Ads campaigns");
  }
  const unified = await resolveUnifiedConnection(scope, campaign.platform);
  await addUnifiedNegativeKeyword(
    unified.connectionId,
    campaign.externalId!,
    payload.keywordText,
    unified.mode,
  );
}

async function readWritesEnabled(scope: Scope): Promise<boolean> {
  return withTenantTransaction(scope, async (client) => {
    const orgId = scope.kind === "org" ? scope.orgId : null;
    if (!orgId) return false;
    const { rows } = await client.query<{ writes_enabled: boolean }>(
      `SELECT writes_enabled FROM adsagent.org_cron_settings WHERE org_id = $1::uuid`,
      [orgId],
    );
    if (!rows[0]) return true;
    return rows[0].writes_enabled;
  });
}

function listingDayNumber(createdAt: Date): number {
  const ms = Date.now() - createdAt.getTime();
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
}

/** In-ceiling share budget move — not a proposal; blocked when the kill switch is on. */
export async function executeShareMove(scope: Scope, listingId: string): Promise<void> {
  if (!(await readWritesEnabled(scope))) {
    throw new Error("share moves are disabled while writes_enabled is false");
  }

  type ListingContext = {
    market: OutboundMarket;
    handle: string;
    createdAt: Date;
    shares: ListingShareRow[];
    ceilings: ListingCeilingRow[];
  };

  const ctx = await withTenantTransaction(scope, async (client) => {
    const listingResult = await client.query<{ market: OutboundMarket; approver_phone: string; created_at: Date }>(
      `SELECT market, approver_phone, created_at FROM adsagent.listings WHERE id = $1::uuid`,
      [listingId],
    );
    const listing = listingResult.rows[0];
    if (!listing) throw new Error(`listing ${listingId} not found`);

    const shareResult = await client.query<ListingShareRow>(
      `SELECT id, platform, external_campaign_id, budget_minor, spend_minor, lead_count, last_share_move_on
         FROM adsagent.listing_shares
        WHERE listing_id = $1::uuid
        ORDER BY id`,
      [listingId],
    );
    const ceilingResult = await client.query<ListingCeilingRow>(
      `SELECT platform, ceiling_minor FROM adsagent.listing_ceilings WHERE listing_id = $1::uuid`,
      [listingId],
    );
    return {
      market: listing.market,
      handle: listing.approver_phone,
      createdAt: listing.created_at,
      shares: shareResult.rows,
      ceilings: ceilingResult.rows,
    } satisfies ListingContext;
  });

  const today = new Date().toISOString().slice(0, 10);
  const dayNumber = listingDayNumber(ctx.createdAt);
  const platforms = [...new Set(ctx.shares.map((s) => s.platform))];

  for (const platform of platforms) {
    const platformShares = ctx.shares.filter((s) => s.platform === platform);
    const ceilingRow = ctx.ceilings.find((c) => c.platform === platform);
    if (!ceilingRow) continue;

    const alreadyMovedToday = platformShares.some(
      (s) => s.last_share_move_on != null && String(s.last_share_move_on).slice(0, 10) === today,
    );

    const decision = reallocateListing({
      writesEnabled: true,
      dayNumber,
      alreadyMovedToday,
      ceilingChangedToday: false,
      ceilingMinor: Number(ceilingRow.ceiling_minor),
      shares: platformShares.map((s) => ({
        id: s.id,
        budgetMinor: Number(s.budget_minor),
        spendMinor: Number(s.spend_minor),
        leads: s.lead_count,
      })),
    });

    if (decision.action === "skip") continue;

    for (const moved of decision.shares) {
      const share = platformShares.find((s) => s.id === moved.id);
      if (!share?.external_campaign_id) {
        throw new Error(`listing share ${moved.id} has no external_campaign_id`);
      }
      const unified = await resolveUnifiedConnection(scope, platform);
      await updateUnifiedCampaignBudget(
        unified.connectionId,
        share.external_campaign_id,
        moved.budgetMinor / 100,
        unified.mode,
      );
    }

    await withTenantTransaction(scope, async (client) => {
      for (const moved of decision.shares) {
        await client.query(
          `UPDATE adsagent.listing_shares
              SET budget_minor = $2, last_share_move_on = $3::date
            WHERE id = $1::uuid`,
          [moved.id, moved.budgetMinor, today],
        );
      }
    });

    const rendered = renderOutbound({
      market: ctx.market,
      kind: "move",
      handle: ctx.handle,
      oldShares: decision.text.oldShares,
      newShares: decision.text.newShares,
      ceilingMinor: decision.text.ceilingMinor,
    });
    console.info(rendered.body);
  }
}

export async function executeProposal(
  scope: Scope,
  proposalId: string,
  faultAt?: ExecuteFaultPoint,
): Promise<ExecuteProposalResult> {
  const proposal = await getProposalById(scope, proposalId);
  if (!proposal) throw new Error(`proposal ${proposalId} not found`);
  if (proposal.status !== "executing") {
    throw new Error(`proposal ${proposalId} is not executing (status: ${proposal.status})`);
  }

  try {
    const kind = executableProposalKind(proposal.kind);
    let listingResult: ListingExecuteResult | undefined;
    switch (kind) {
      case "create_campaign":
        if (isListingCreatePayload(proposal.payload)) {
          listingResult = await executeListingCreateCampaign(scope, proposalId, proposal.payload, faultAt);
        } else {
          await executeCreateCampaign(scope, proposal.payload as unknown as CreateCampaignPayload);
        }
        break;
      case "pause":
        await executePause(scope, proposal.payload as unknown as CampaignActionPayload);
        break;
      case "budget_change":
        await executeBudgetChange(scope, proposal.payload);
        break;
      case "add_negative_keyword":
        await executeAddNegativeKeyword(scope, proposal.payload as unknown as NegativeKeywordPayload);
        break;
      case "campaign_strategy":
        break;
      default:
        throw new Error(`executeProposal: unhandled proposal kind "${proposal.kind}"`);
    }
    await markProposalExecuted(scope, proposalId);
    return listingResult ? { status: "executed", result: listingResult } : { status: "executed" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markProposalFailed(scope, proposalId, message);
    return { status: "failed", error: message };
  }
}
