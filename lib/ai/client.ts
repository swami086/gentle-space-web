import * as openai from "../openai/client";
import * as vertex from "../vertex/client";
import { emptyQueryEntities, type QueryEntities } from "../graph/types";
import { emptyInsightContent } from "../spaces/insight-prompt";
import type { InsightContent, InsightFacts } from "../spaces/insight-types";

export function aiProvider(): "vertex" | "openai" {
  if (process.env.AI_PROVIDER === "vertex") return "vertex";
  if (process.env.AI_PROVIDER === "openai") return "openai";
  if (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return "vertex";
  }
  return "openai";
}

export function isAiSearchConfigured(): boolean {
  if (!process.env.DATABASE_URL) return false;
  if (aiProvider() === "vertex") {
    return Boolean(
      process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_APPLICATION_CREDENTIALS,
    );
  }
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  return aiProvider() === "vertex" ? vertex.embedTexts(texts) : openai.embedTexts(texts);
}

export async function rewriteSearchQuery(query: string): Promise<string> {
  return aiProvider() === "vertex"
    ? vertex.rewriteSearchQuery(query)
    : openai.rewriteSearchQuery(query);
}

export async function extractSearchEntities(text: string): Promise<QueryEntities> {
  try {
    return aiProvider() === "vertex"
      ? await vertex.extractSearchEntities(text)
      : await openai.extractSearchEntities(text);
  } catch (error) {
    console.error("extractSearchEntities failed", error);
    return emptyQueryEntities();
  }
}

// Batches many listings into one LLM call instead of one call per listing —
// cuts request count (and cost) by ~chunk-size×, and incidentally keeps sync
// runs well under per-minute Gemini quota instead of firing one request per row.
export async function extractSearchEntitiesBatch(texts: string[]): Promise<QueryEntities[]> {
  if (texts.length === 0) return [];
  try {
    return aiProvider() === "vertex"
      ? await vertex.extractSearchEntitiesBatch(texts)
      : await openai.extractSearchEntitiesBatch(texts);
  } catch (error) {
    console.error("extractSearchEntitiesBatch failed", error);
    return texts.map(() => emptyQueryEntities());
  }
}

export async function extractListingEntities(text: string): Promise<QueryEntities> {
  try {
    return aiProvider() === "vertex"
      ? await vertex.extractListingEntities(text)
      : await openai.extractListingEntities(text);
  } catch (error) {
    console.error("extractListingEntities failed", error);
    return emptyQueryEntities();
  }
}

export async function explainListingFit(facts: InsightFacts): Promise<InsightContent> {
  try {
    return aiProvider() === "vertex"
      ? await vertex.explainListingFit(facts)
      : await openai.explainListingFit(facts);
  } catch (error) {
    console.error("explainListingFit failed", error);
    return emptyInsightContent();
  }
}
