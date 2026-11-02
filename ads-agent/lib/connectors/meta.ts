import axios from "axios";
import * as bizSdk from "facebook-nodejs-business-sdk";
import { requireEnv } from "../env";

const {
  FacebookAdsApi,
  AdAccount,
  Campaign,
  AdSet,
  Ad,
  AdCreative,
  Page,
} = bizSdk as typeof import("facebook-nodejs-business-sdk");

const META_IDEMPOTENCY_HEADER = "X-Client-Idempotent-Key";

type RawInsightRow = {
  campaign_id: string;
  spend: string;
  clicks: string;
  impressions: string;
  actions?: { action_type: string; value: string }[];
};

export type MetaPerformanceRow = {
  externalCampaignId: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
};

export type CreateMetaListingSharesInput = {
  proposalId: string;
  name: string;
  endTimeIso: string;
  pageId: string;
  shares: {
    name: string;
    lifetimeBudgetMinor: number;
    message: string;
    imageHash: string;
    link: string;
  }[];
};

export type CreateMetaListingSharesResult = {
  campaignId: string;
  formId: string;
  shares: { adSetId: string; adId: string }[];
};

function account(): InstanceType<typeof AdAccount> {
  FacebookAdsApi.init(requireEnv("META_ACCESS_TOKEN"));
  return new AdAccount(`act_${requireEnv("META_AD_ACCOUNT_ID")}`);
}

function listingMetaApi(): InstanceType<typeof FacebookAdsApi> {
  return new FacebookAdsApi(requireEnv("META_ACCESS_TOKEN"));
}

function listingPage(api: InstanceType<typeof FacebookAdsApi>, pageId: string): InstanceType<typeof Page> {
  return new Page(pageId, {}, undefined, api);
}

function metaIdempotencyKey(proposalId: string, objectName: string): string {
  return `${proposalId}:${objectName}`;
}

function leadFormPrivacyUrl(shares: CreateMetaListingSharesInput["shares"]): string {
  const fromEnv = process.env.META_PRIVACY_POLICY_URL;
  if (fromEnv) return fromEnv;
  const link = shares[0]?.link;
  if (link) {
    try {
      return new URL("/privacy", link).href;
    } catch {
      return link;
    }
  }
  return "https://example.com/privacy";
}

function defaultTargetCountry(): string {
  return process.env.META_AD_TARGET_COUNTRY ?? "IN";
}

async function postWithIdempotencyKey(
  api: InstanceType<typeof FacebookAdsApi>,
  path: string[],
  data: Record<string, unknown>,
  idempotencyKey: string,
): Promise<{ id: string }> {
  const url =
    [FacebookAdsApi.GRAPH, FacebookAdsApi.VERSION, ...path].join("/") +
    `?${FacebookAdsApi._encodeParams({ access_token: api.accessToken })}`;
  const response = await axios({
    method: "POST",
    url,
    data,
    headers: {
      "User-Agent": `fbbizsdk-nodejs-v${FacebookAdsApi.SDK_VERSION}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      [META_IDEMPOTENCY_HEADER]: idempotencyKey,
    },
  });
  return response.data as { id: string };
}

function listingAccountPath(): string[] {
  return [`act_${requireEnv("META_AD_ACCOUNT_ID")}`];
}

function leadConversions(actions: RawInsightRow["actions"]): number {
  const leadAction = (actions ?? []).find((a) => a.action_type === "lead");
  return leadAction ? Number(leadAction.value) : 0;
}

export async function fetchMetaPerformance(): Promise<MetaPerformanceRow[]> {
  const rows = (await account().getInsights(
    [Campaign.Fields.campaign_id, "spend", "clicks", "impressions", "actions"],
    { level: "campaign", date_preset: "last_3d" },
  )) as unknown as RawInsightRow[];

  return rows.map((row) => ({
    externalCampaignId: row.campaign_id,
    spend: Number(row.spend),
    clicks: Number(row.clicks),
    impressions: Number(row.impressions),
    conversions: leadConversions(row.actions),
  }));
}

export async function createMetaCampaign(input: {
  name: string;
  dailyBudgetInr: number;
}): Promise<string> {
  const campaign = (await account().createCampaign([], {
    [Campaign.Fields.name]: input.name,
    [Campaign.Fields.status]: Campaign.Status.active,
    [Campaign.Fields.objective]: Campaign.Objective.link_clicks,
    [Campaign.Fields.daily_budget]: Math.round(input.dailyBudgetInr * 100),
  })) as { id: string };
  return campaign.id;
}

export async function pauseMetaCampaign(externalCampaignId: string): Promise<void> {
  FacebookAdsApi.init(requireEnv("META_ACCESS_TOKEN"));
  await new Campaign(externalCampaignId).update({
    [Campaign.Fields.status]: Campaign.Status.paused,
  });
}

export async function updateMetaCampaignBudget(
  externalCampaignId: string,
  dailyBudgetInr: number,
): Promise<void> {
  FacebookAdsApi.init(requireEnv("META_ACCESS_TOKEN"));
  await new Campaign(externalCampaignId).update({
    [Campaign.Fields.daily_budget]: Math.round(dailyBudgetInr * 100),
  });
}

export async function createMetaListingShares(
  input: CreateMetaListingSharesInput,
): Promise<CreateMetaListingSharesResult> {
  const api = listingMetaApi();
  const page = listingPage(api, input.pageId);

  const form = (await page.createLeadGenForm([], {
    name: `${input.proposalId} lead form`,
    questions: [
      { type: "FULL_NAME", key: "full_name" },
      { type: "EMAIL", key: "email" },
      { type: "PHONE", key: "phone" },
    ],
    privacy_policy: {
      url: leadFormPrivacyUrl(input.shares),
      link_text: "Privacy Policy",
    },
    follow_up_action_url: input.shares[0]?.link,
  })) as { id: string };

  const campaign = await postWithIdempotencyKey(
    api,
    [...listingAccountPath(), "campaigns"],
    {
      [Campaign.Fields.name]: input.name,
      [Campaign.Fields.status]: Campaign.Status.paused,
      [Campaign.Fields.objective]: Campaign.Objective.outcome_leads,
      special_ad_categories: ["NONE"],
    },
    metaIdempotencyKey(input.proposalId, input.name),
  );
  const campaignId = campaign.id;

  const shareResults: CreateMetaListingSharesResult["shares"] = [];
  for (const share of input.shares) {
    const adSet = await postWithIdempotencyKey(
      api,
      [...listingAccountPath(), "adsets"],
      {
        [AdSet.Fields.name]: share.name,
        [AdSet.Fields.campaign_id]: campaignId,
        [AdSet.Fields.lifetime_budget]: share.lifetimeBudgetMinor,
        [AdSet.Fields.end_time]: input.endTimeIso,
        [AdSet.Fields.status]: AdSet.Status.paused,
        [AdSet.Fields.billing_event]: AdSet.BillingEvent.impressions,
        [AdSet.Fields.optimization_goal]: AdSet.OptimizationGoal.lead_generation,
        [AdSet.Fields.destination_type]: AdSet.DestinationType.on_ad,
        [AdSet.Fields.bid_strategy]: AdSet.BidStrategy.lowest_cost_without_cap,
        [AdSet.Fields.promoted_object]: {
          page_id: input.pageId,
          lead_gen_form_id: form.id,
        },
        [AdSet.Fields.targeting]: {
          geo_locations: { countries: [defaultTargetCountry()] },
        },
      },
      metaIdempotencyKey(input.proposalId, share.name),
    );
    const adSetId = adSet.id;

    const creativeName = `${share.name} creative`;
    const creative = await postWithIdempotencyKey(
      api,
      [...listingAccountPath(), "adcreatives"],
      {
        [AdCreative.Fields.name]: creativeName,
        [AdCreative.Fields.object_story_spec]: {
          page_id: input.pageId,
          link_data: {
            message: share.message,
            link: share.link,
            image_hash: share.imageHash,
            call_to_action: {
              type: "LEARN_MORE",
              value: { lead_gen_form_id: form.id },
            },
          },
        },
      },
      metaIdempotencyKey(input.proposalId, creativeName),
    );
    const creativeId = creative.id;

    const adName = `${share.name} ad`;
    const ad = await postWithIdempotencyKey(
      api,
      [...listingAccountPath(), "ads"],
      {
        [Ad.Fields.name]: adName,
        [Ad.Fields.adset_id]: adSetId,
        [Ad.Fields.creative]: { creative_id: creativeId },
        [Ad.Fields.status]: Ad.Status.paused,
      },
      metaIdempotencyKey(input.proposalId, adName),
    );

    shareResults.push({ adSetId, adId: ad.id });
  }

  return { campaignId, formId: form.id, shares: shareResults };
}

export async function updateMetaAdSetLifetimeBudget(
  adSetId: string,
  lifetimeBudgetMinor: number,
): Promise<void> {
  const api = listingMetaApi();
  await new AdSet(adSetId, {}, undefined, api).update({
    [AdSet.Fields.lifetime_budget]: lifetimeBudgetMinor,
  });
}
