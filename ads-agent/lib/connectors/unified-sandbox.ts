const API = "https://api.unified.to";

export type UnifiedWriteMode = "test" | "production";

export type PausedUnifiedCampaign = {
  connectionId: string;
  name: string;
  budgetAmount: number;
  budgetPeriod: "TOTAL" | "LIFETIME" | "DAILY";
  advertisingChannelType?: "SEARCH";
  goal?: "LEADS" | "WEBSITE_TRAFFIC";
};

const connectionModes = new Map<string, UnifiedWriteMode>();

/** Clears in-process mode memory (tests only). */
export function resetUnifiedConnectionModesForTest(): void {
  connectionModes.clear();
}

export function unifiedSandboxConfigured(): boolean {
  return Boolean(
    process.env.UNIFIED_API_KEY &&
      process.env.UNIFIED_GOOGLE_ADS_CONNECTION_ID &&
      process.env.UNIFIED_META_ADS_CONNECTION_ID,
  );
}

async function unifiedFetch(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const key = process.env.UNIFIED_API_KEY;
  if (!key) throw new Error("UNIFIED_API_KEY is not set");
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${key}`,
      accept: "application/json",
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`unified ${path} failed: ${response.status} ${text.slice(0, 180)}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function readUnifiedConnection(connectionId: string): Promise<Record<string, unknown>> {
  return unifiedFetch(`/unified/connection/${connectionId}`);
}

function connectionIsSandbox(row: Record<string, unknown>): boolean {
  return row.environment === "Sandbox";
}

async function assertConnectionForWrite(connectionId: string, mode: UnifiedWriteMode): Promise<void> {
  const row = await readUnifiedConnection(connectionId);
  const sandbox = connectionIsSandbox(row);
  if (mode === "test" && !sandbox) {
    throw new Error(`unified connection ${connectionId} is not Sandbox`);
  }
  if (mode === "production" && sandbox) {
    throw new Error(`unified connection ${connectionId} is Sandbox, not production`);
  }
  const seen = connectionModes.get(connectionId);
  if (seen && seen !== mode) {
    throw new Error(`unified connection ${connectionId} cannot be used for both test and production`);
  }
  connectionModes.set(connectionId, mode);
}

/** @deprecated Use assertConnectionForWrite via write helpers. */
export async function assertUnifiedSandbox(connectionId: string): Promise<void> {
  await assertConnectionForWrite(connectionId, "test");
}

export async function createPausedUnifiedCampaign(
  input: PausedUnifiedCampaign,
  mode: UnifiedWriteMode = "test",
): Promise<string> {
  await assertConnectionForWrite(input.connectionId, mode);
  const created = await unifiedFetch(`/ads/${input.connectionId}/campaign`, {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      status: "PAUSED",
      budget_amount: input.budgetAmount,
      budget_period: input.budgetPeriod,
      ...(input.advertisingChannelType ? { advertising_channel_type: input.advertisingChannelType } : {}),
      ...(input.goal ? { goal: input.goal } : {}),
    }),
  });
  if (typeof created.id !== "string" || created.status !== "PAUSED") {
    throw new Error("unified sandbox campaign was not created paused");
  }
  const readback = await unifiedFetch(`/ads/${input.connectionId}/campaign/${created.id}`);
  if (readback.status !== "PAUSED") {
    throw new Error("unified sandbox campaign readback was not paused");
  }
  return created.id;
}

export async function pauseUnifiedCampaign(
  connectionId: string,
  campaignId: string,
  mode: UnifiedWriteMode = "test",
): Promise<void> {
  await assertConnectionForWrite(connectionId, mode);
  const updated = await unifiedFetch(`/ads/${connectionId}/campaign/${campaignId}`, {
    method: "PUT",
    body: JSON.stringify({ status: "PAUSED" }),
  });
  if (updated.status !== "PAUSED") {
    throw new Error("unified campaign was not paused");
  }
}

export async function updateUnifiedCampaignBudget(
  connectionId: string,
  campaignId: string,
  budgetAmount: number,
  mode: UnifiedWriteMode = "test",
): Promise<void> {
  await assertConnectionForWrite(connectionId, mode);
  const current = await unifiedFetch(
    `/ads/${connectionId}/campaign/${campaignId}?fields=budget_period`,
  );
  const budgetPeriod = current.budget_period;
  if (
    budgetPeriod !== "DAILY" &&
    budgetPeriod !== "MONTHLY" &&
    budgetPeriod !== "TOTAL" &&
    budgetPeriod !== "LIFETIME"
  ) {
    throw new Error("unified campaign has no budget period");
  }
  const updated = await unifiedFetch(`/ads/${connectionId}/campaign/${campaignId}`, {
    method: "PUT",
    body: JSON.stringify({ budget_amount: budgetAmount, budget_period: budgetPeriod }),
  });
  if (updated.budget_amount !== budgetAmount || updated.budget_period !== budgetPeriod) {
    throw new Error("unified campaign budget was not updated");
  }
}

export async function addUnifiedNegativeKeyword(
  connectionId: string,
  campaignId: string,
  keywordText: string,
  mode: UnifiedWriteMode = "test",
): Promise<void> {
  await assertConnectionForWrite(connectionId, mode);
  const current = await unifiedFetch(
    `/ads/${connectionId}/campaign/${campaignId}?fields=targeting`,
  );
  const targeting = current.targeting;
  const content =
    targeting && typeof targeting === "object"
      ? (targeting as { content?: { excluded_keywords?: unknown } }).content
      : undefined;
  const existing = Array.isArray(content?.excluded_keywords) ? content.excluded_keywords : [];
  const keywords = existing.flatMap((item) => {
    if (!item || typeof item !== "object" || typeof (item as { text?: unknown }).text !== "string") {
      return [];
    }
    const matchType = (item as { match_type?: unknown }).match_type;
    return [
      {
        text: (item as { text: string }).text,
        match_type: matchType === "BROAD" || matchType === "EXACT" || matchType === "PHRASE" ? matchType : "PHRASE",
      },
    ];
  });
  if (!keywords.some((keyword) => keyword.text === keywordText)) {
    keywords.push({ text: keywordText, match_type: "PHRASE" });
  }
  const updated = await unifiedFetch(`/ads/${connectionId}/campaign/${campaignId}`, {
    method: "PUT",
    body: JSON.stringify({ targeting: { content: { excluded_keywords: keywords } } }),
  });
  const saved = updated.targeting;
  const savedContent =
    saved && typeof saved === "object"
      ? (saved as { content?: { excluded_keywords?: { text?: string }[] } }).content
      : undefined;
  if (!savedContent?.excluded_keywords?.some((keyword) => keyword.text === keywordText)) {
    throw new Error("unified negative keyword was not saved");
  }
}

export async function activateUnifiedCampaign(
  connectionId: string,
  campaignId: string,
  opts: { canActivate: boolean; mode: UnifiedWriteMode },
): Promise<void> {
  const row = await readUnifiedConnection(connectionId);
  const sandbox = connectionIsSandbox(row);
  if (!opts.canActivate || opts.mode === "test" || sandbox) {
    throw new Error("unified campaign activation is not allowed");
  }
  await assertConnectionForWrite(connectionId, "production");
  const updated = await unifiedFetch(`/ads/${connectionId}/campaign/${campaignId}`, {
    method: "PUT",
    body: JSON.stringify({ status: "ACTIVE" }),
  });
  if (updated.status !== "ACTIVE") {
    throw new Error("unified campaign was not activated");
  }
}
