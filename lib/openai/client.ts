import { EXTRACT_SYSTEM, parseExtractedEntitiesJson } from "../graph/extract";
import {
  INSIGHT_SYSTEM,
  buildInsightUserText,
  parseInsightJson,
} from "../spaces/insight-prompt";
import type { InsightContent, InsightFacts } from "../spaces/insight-types";

const OPENAI_BASE = "https://api.openai.com/v1";

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return key;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch(`${OPENAI_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: texts,
    }),
  });
  if (!res.ok) {
    throw new Error(`embeddings failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    data: { embedding: number[]; index: number }[];
  };
  return body.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

const REWRITE_SYSTEM = `You rewrite coworking/office search queries for Bangalore.
Return one short line: desk/cabin type, amenities, area, budget if present.
Use " · " between clauses. Do not invent neighborhoods. No markdown.`;

export async function rewriteSearchQuery(query: string): Promise<string> {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: REWRITE_SYSTEM },
        { role: "user", content: query },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`rewrite failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  const content = body.choices[0]?.message?.content?.trim();
  return content || query.trim();
}

async function extractEntities(text: string): Promise<ReturnType<typeof parseExtractedEntitiesJson>> {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: EXTRACT_SYSTEM },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`extract failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    choices: { message?: { content?: string | null } }[];
  };
  const content = body.choices[0]?.message?.content?.trim() || "{}";
  return parseExtractedEntitiesJson(content);
}

export async function extractSearchEntities(text: string) {
  return extractEntities(text);
}

export async function extractListingEntities(text: string) {
  return extractEntities(text);
}

export async function explainListingFit(facts: InsightFacts): Promise<InsightContent> {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: INSIGHT_SYSTEM },
        { role: "user", content: buildInsightUserText(facts) },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`insight failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    choices: { message?: { content?: string | null } }[];
  };
  const content = body.choices[0]?.message?.content?.trim() || "{}";
  return parseInsightJson(content);
}
