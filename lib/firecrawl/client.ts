import type { ExtractResult } from "../sync/enrich-gate";

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";

type FirecrawlResponse<T> = T & { success: boolean; error?: string };

function getApiKey(): string {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY is not set");
  return key;
}

async function firecrawlPost<T>(path: string, body: unknown): Promise<FirecrawlResponse<T>> {
  const res = await fetch(`${FIRECRAWL_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as FirecrawlResponse<T>;
  if (!res.ok || !json.success) {
    throw new Error(json.error ?? `Firecrawl ${path} failed (${res.status})`);
  }
  return json;
}

export async function firecrawlScrape(
  url: string,
  options: { includeLinks?: boolean } = {},
): Promise<{ markdown: string; links: string[] }> {
  const formats = options.includeLinks ? ["markdown", "links"] : ["markdown"];
  const json = await firecrawlPost<{ data: { markdown?: string; links?: string[] } }>("/scrape", {
    url,
    formats,
    onlyMainContent: true,
  });
  return {
    markdown: json.data.markdown ?? "",
    links: json.data.links ?? [],
  };
}

export async function firecrawlMap(url: string): Promise<string[]> {
  const json = await firecrawlPost<{ links?: string[] }>("/map", { url });
  return json.links ?? [];
}

/* -------------------- v2 extract client -------------------- */
const FIRECRAWL_V2_BASE = "https://api.firecrawl.dev/v2";
const EXTRACT_URL_BATCH = 10;

export const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    listings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source_url: { type: "string" },
          locality: { type: ["string", "null"] },
          address: { type: ["string", "null"] },
          monthly_price_inr: { type: ["number", "null"] },
          price_basis: { type: ["string", "null"], enum: ["exact", "from", null] },
          brand_match: { type: "boolean" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          evidence: { type: ["string", "null"] },
        },
        required: ["source_url", "confidence"],
      },
    },
  },
} as const;

export const EXTRACT_PROMPT = `Extract coworking listing location and monthly desk price for Bangalore/Bengaluru only.
For EACH provided URL, return one object in listings[] with the exact source_url.
locality must be a neighbourhood name (not floor, door, landmark phrase, or bare city).
Prefer monthly desk/seat rates; leave price null rather than invent a unit.
brand_match true only when the page clearly refers to this listing's title/brand.
Prefer null over a guess.`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function asExtractResult(raw: unknown): ExtractResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const confidence = o.confidence;
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") return null;
  return {
    locality: typeof o.locality === "string" ? o.locality : null,
    address: typeof o.address === "string" ? o.address : null,
    monthly_price_inr: typeof o.monthly_price_inr === "number" ? o.monthly_price_inr : null,
    price_basis: o.price_basis === "exact" || o.price_basis === "from" ? o.price_basis : null,
    brand_match: Boolean(o.brand_match),
    confidence,
    evidence: typeof o.evidence === "string" ? o.evidence : null,
  };
}

function normalizeExtractData(data: unknown, urls: string[]): Map<string, ExtractResult> {
  const out = new Map<string, ExtractResult>();
  if (!data || typeof data !== "object") return out;
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.listings)) {
    for (const row of obj.listings) {
      if (!row || typeof row !== "object") continue;
      const sourceUrl = (row as { source_url?: unknown }).source_url;
      const parsed = asExtractResult(row);
      if (typeof sourceUrl === "string" && parsed) out.set(sourceUrl, parsed);
    }
    return out;
  }
  if (urls.length === 1) {
    const parsed = asExtractResult(data);
    if (parsed) out.set(urls[0]!, parsed);
  }
  return out;
}

async function firecrawlExtractOnce(
  urls: string[],
  options: {
    prompt: string;
    schema: object;
    enableWebSearch: boolean;
    allowExternalLinks: boolean;
    pollMs: number;
    timeoutMs: number;
  },
): Promise<Map<string, ExtractResult>> {
  const startRes = await fetch(`${FIRECRAWL_V2_BASE}/extract`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      urls,
      prompt: options.prompt,
      schema: options.schema,
      enableWebSearch: options.enableWebSearch,
      allowExternalLinks: options.allowExternalLinks,
      ignoreInvalidURLs: true,
    }),
  });
  const startJson = (await startRes.json()) as { success?: boolean; id?: string; error?: string };
  if (!startRes.ok || !startJson.success || !startJson.id) {
    throw new Error(startJson.error ?? `Firecrawl extract start failed (${startRes.status})`);
  }

  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const statusRes = await fetch(`${FIRECRAWL_V2_BASE}/extract/${startJson.id}`, {
      headers: { Authorization: `Bearer ${getApiKey()}` },
    });
    const statusJson = (await statusRes.json()) as {
      success?: boolean;
      status?: string;
      data?: unknown;
      error?: string;
    };
    if (!statusRes.ok) {
      throw new Error(statusJson.error ?? `Firecrawl extract poll failed (${statusRes.status})`);
    }
    if (statusJson.status === "completed") {
      return normalizeExtractData(statusJson.data, urls);
    }
    if (statusJson.status === "failed" || statusJson.status === "cancelled") {
      throw new Error(statusJson.error ?? `Firecrawl extract ${statusJson.status}`);
    }
    await sleep(options.pollMs);
  }
  throw new Error(`Firecrawl extract timed out after ${options.timeoutMs}ms`);
}

export async function firecrawlExtract(
  urls: string[],
  options: {
    prompt?: string;
    schema?: object;
    enableWebSearch?: boolean;
    allowExternalLinks?: boolean;
    pollMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<Map<string, ExtractResult>> {
  const unique = [...new Set(urls.filter(Boolean))];
  const merged = new Map<string, ExtractResult>();
  const prompt = options.prompt ?? EXTRACT_PROMPT;
  const schema = options.schema ?? EXTRACT_SCHEMA;
  const enableWebSearch = options.enableWebSearch ?? false;
  const allowExternalLinks = options.allowExternalLinks ?? enableWebSearch;
  const pollMs = options.pollMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 180_000;

  for (let i = 0; i < unique.length; i += EXTRACT_URL_BATCH) {
    const chunk = unique.slice(i, i + EXTRACT_URL_BATCH);
    const part = await firecrawlExtractOnce(chunk, {
      prompt,
      schema,
      enableWebSearch,
      allowExternalLinks,
      pollMs,
      timeoutMs,
    });
    for (const [k, v] of part) merged.set(k, v);
  }
  return merged;
}
