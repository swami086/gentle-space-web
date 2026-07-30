import { getVertexAccessToken } from "./auth";
import { EXTRACT_SYSTEM, parseExtractedEntitiesJson } from "../graph/extract";

const REWRITE_SYSTEM = `You rewrite coworking/office search queries for Bangalore.
Return one short line: desk/cabin type, amenities, area, budget if present.
Use " · " between clauses. Do not invent neighborhoods. No markdown.`;

function projectId(): string {
  const id = process.env.GOOGLE_CLOUD_PROJECT;
  if (!id) throw new Error("GOOGLE_CLOUD_PROJECT is not set");
  return id;
}

function location(): string {
  return process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
}

function chatModel(): string {
  return process.env.VERTEX_CHAT_MODEL || "gemini-2.5-flash-lite";
}

function embedModel(): string {
  return process.env.VERTEX_EMBED_MODEL || "text-embedding-004";
}

function modelUrl(model: string, method: "predict" | "generateContent"): string {
  const base = `https://${location()}-aiplatform.googleapis.com/v1`;
  return `${base}/projects/${projectId()}/locations/${location()}/publishers/google/models/${model}:${method}`;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const token = await getVertexAccessToken();
  const res = await fetch(modelUrl(embedModel(), "predict"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instances: texts.map((content) => ({
        content,
        task_type: "RETRIEVAL_DOCUMENT",
      })),
    }),
  });
  if (!res.ok) {
    throw new Error(`vertex embeddings failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    predictions: { embeddings: { values: number[] } }[];
  };
  return body.predictions.map((p) => p.embeddings.values);
}

export async function rewriteSearchQuery(query: string): Promise<string> {
  const token = await getVertexAccessToken();
  const res = await fetch(modelUrl(chatModel(), "generateContent"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: REWRITE_SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: query }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 120 },
    }),
  });
  if (!res.ok) {
    throw new Error(`vertex rewrite failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const content = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  return content || query.trim();
}

async function extractEntities(text: string): Promise<ReturnType<typeof parseExtractedEntitiesJson>> {
  const token = await getVertexAccessToken();
  const res = await fetch(modelUrl(chatModel(), "generateContent"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: EXTRACT_SYSTEM }] },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    }),
  });
  if (!res.ok) {
    throw new Error(`vertex extract failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const content = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "{}";
  return parseExtractedEntitiesJson(content);
}

export async function extractSearchEntities(text: string) {
  return extractEntities(text);
}

export async function extractListingEntities(text: string) {
  return extractEntities(text);
}
