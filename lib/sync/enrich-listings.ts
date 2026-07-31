import {
  applyListingEnrichment,
  insertEnrichmentLog,
  listEnrichmentCandidates,
  listRecentlyAcceptedEnrichmentIds,
} from "../db/listings";
import { firecrawlExtract } from "../firecrawl/client";
import { gateLocation, gatePrice, type ExtractResult } from "./enrich-gate";
import { isWeakListing, type EnrichCandidate } from "./enrich-weak";

export type EnrichListingsResult = {
  scanned: number;
  queued: number;
  pageAccepted: number;
  webAccepted: number;
  skippedCooldown: number;
};

type EnrichListingsOptions = {
  dryRun?: boolean;
  webLimit?: number;
  cooldownDays?: number;
};

type ListingPatch = {
  area?: string;
  address?: string;
  pricingHint?: string;
  locationChanged: boolean;
  priceChanged: boolean;
};

const DEFAULT_WEB_LIMIT = 100;
const DEFAULT_COOLDOWN_DAYS = 7;

function readNonNegativeInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function locationChanged(
  candidate: EnrichCandidate,
  next: { area: string; address: string },
): boolean {
  return candidate.area !== next.area || candidate.address !== next.address;
}

function buildPatch(
  candidate: EnrichCandidate,
  result: ExtractResult | undefined,
  options: { pass2Locality?: string | null } = {},
): ListingPatch | null {
  if (!result) return null;

  const patch: ListingPatch = {
    locationChanged: false,
    priceChanged: false,
  };

  const location = gateLocation(result, options);
  if (location.accept && locationChanged(candidate, location)) {
    patch.area = location.area;
    patch.address = location.address;
    patch.locationChanged = true;
  }

  const price = gatePrice(result, candidate.pricingHint);
  if (price.accept && candidate.pricingHint !== price.pricingHint) {
    patch.pricingHint = price.pricingHint;
    patch.priceChanged = true;
  }

  return patch.locationChanged || patch.priceChanged ? patch : null;
}

function applyPatchToCandidate(candidate: EnrichCandidate, patch: ListingPatch): EnrichCandidate {
  const next = { ...candidate };

  if (patch.area !== undefined) next.area = patch.area;
  if (patch.address !== undefined) next.address = patch.address;
  if (patch.pricingHint !== undefined) next.pricingHint = patch.pricingHint;
  if (patch.locationChanged) {
    next.lat = null;
    next.lng = null;
  }

  return next;
}

async function persistPatch(
  candidate: EnrichCandidate,
  patch: ListingPatch,
  options: { dryRun: boolean },
): Promise<void> {
  if (options.dryRun) return;
  await applyListingEnrichment(candidate.id, patch);
}

async function logAttempt(
  candidate: EnrichCandidate,
  pass: "page" | "web",
  accepted: boolean,
  result: ExtractResult | undefined,
): Promise<void> {
  await insertEnrichmentLog({
    listingId: candidate.id,
    pass,
    accepted,
    payload: {
      sourceUrl: candidate.sourceUrl,
      result: result ?? null,
    },
  });
}

export async function enrichListings(
  options: EnrichListingsOptions = {},
): Promise<EnrichListingsResult> {
  if (process.env.ENRICH_DISABLED === "1") {
    return {
      scanned: 0,
      queued: 0,
      pageAccepted: 0,
      webAccepted: 0,
      skippedCooldown: 0,
    };
  }

  const dryRun = options.dryRun ?? false;
  const webLimit = options.webLimit ?? readNonNegativeInt(process.env.ENRICH_WEB_LIMIT, DEFAULT_WEB_LIMIT);
  const cooldownDays =
    options.cooldownDays ?? readNonNegativeInt(process.env.ENRICH_COOLDOWN_DAYS, DEFAULT_COOLDOWN_DAYS);

  const candidates = await listEnrichmentCandidates();
  const recentAccepts = await listRecentlyAcceptedEnrichmentIds(cooldownDays);

  const queued: EnrichCandidate[] = [];
  let skippedCooldown = 0;

  for (const candidate of candidates) {
    if (!isWeakListing(candidate)) continue;
    const acceptedAt = recentAccepts.get(candidate.id);
    if (acceptedAt && acceptedAt >= candidate.syncedAt) {
      skippedCooldown += 1;
      continue;
    }
    queued.push({ ...candidate });
  }

  const result: EnrichListingsResult = {
    scanned: candidates.length,
    queued: queued.length,
    pageAccepted: 0,
    webAccepted: 0,
    skippedCooldown,
  };

  if (queued.length === 0) return result;

  const urls = queued.map((candidate) => candidate.sourceUrl);
  const pass1Results = await firecrawlExtract(urls, { enableWebSearch: false });
  const pass1LocalityById = new Map<string, string | null>();

  for (let index = 0; index < queued.length; index += 1) {
    const candidate = queued[index]!;
    const pass1 = pass1Results.get(candidate.sourceUrl);
    const pass1Location = pass1 ? gateLocation(pass1) : null;
    pass1LocalityById.set(candidate.id, pass1Location?.accept ? pass1Location.area : pass1?.locality ?? null);
    const patch = buildPatch(candidate, pass1);

    await logAttempt(candidate, "page", patch != null, pass1);
    if (!patch) continue;

    await persistPatch(candidate, patch, { dryRun });
    queued[index] = applyPatchToCandidate(candidate, patch);
    result.pageAccepted += 1;
  }

  if (webLimit === 0) return result;

  const pass2Queue = queued.filter((candidate) => isWeakListing(candidate)).slice(0, webLimit);
  if (pass2Queue.length === 0) return result;

  const pass2Results = await firecrawlExtract(
    pass2Queue.map((candidate) => candidate.sourceUrl),
    { enableWebSearch: true },
  );

  for (const candidate of pass2Queue) {
    const pass2 = pass2Results.get(candidate.sourceUrl);
    const patch = buildPatch(candidate, pass2, {
      pass2Locality: pass1LocalityById.get(candidate.id) ?? null,
    });

    await logAttempt(candidate, "web", patch != null, pass2);
    if (!patch) continue;

    await persistPatch(candidate, patch, { dryRun });
    result.webAccepted += 1;
  }

  return result;
}
