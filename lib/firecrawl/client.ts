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
): Promise<{ markdown: string; links: string[] }> {
  const json = await firecrawlPost<{ data: { markdown?: string; links?: string[] } }>("/scrape", {
    url,
    formats: ["markdown", "links"],
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
