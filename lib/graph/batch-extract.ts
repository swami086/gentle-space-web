import { EXTRACT_SYSTEM, parseExtractedEntitiesJson } from "./extract";
import type { QueryEntities } from "./types";

const LISTING_ID_RE =
  /^LISTING_ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

function readText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const text = (value as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}

function readFirstPartText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const parts = (value as { parts?: unknown }).parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  return readText(parts[0]);
}

function extractListingIdFromRequest(request: unknown): string | null {
  if (!request || typeof request !== "object") return null;
  const contents = (request as { contents?: unknown }).contents;
  if (!Array.isArray(contents) || contents.length === 0) return null;
  const text = readFirstPartText(contents[0]);
  if (!text) return null;
  const match = LISTING_ID_RE.exec(text);
  return match?.[1]?.toLowerCase() ?? null;
}

function extractResponseText(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const candidates = (response as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const content = (candidates[0] as { content?: unknown }).content;
  if (!content || typeof content !== "object") return null;
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  return readText(parts[0]);
}

export function buildEntityBatchJsonlLine(listingId: string, listingText: string): string {
  return JSON.stringify({
    request: {
      systemInstruction: { parts: [{ text: EXTRACT_SYSTEM }] },
      contents: [
        {
          role: "user",
          parts: [{ text: `LISTING_ID: ${listingId}\n${listingText}` }],
        },
      ],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    },
  });
}

export function buildEntityBatchJsonl(items: { id: string; text: string }[]): string {
  if (items.length === 0) return "";
  return `${items.map((item) => buildEntityBatchJsonlLine(item.id, item.text)).join("\n")}\n`;
}

export function parseEntityBatchOutputLine(line: string): {
  listingId: string | null;
  entities: QueryEntities | null;
  failed: boolean;
} {
  const trimmed = line.trim();
  if (!trimmed) return { listingId: null, entities: null, failed: false };

  let row: { status?: unknown; request?: unknown; response?: unknown };
  try {
    row = JSON.parse(trimmed) as typeof row;
  } catch {
    return { listingId: null, entities: null, failed: false };
  }

  const listingId = extractListingIdFromRequest(row.request);
  const status = typeof row.status === "string" ? row.status.trim() : "";
  if (status) return { listingId, entities: null, failed: true };

  const responseText = extractResponseText(row.response);
  if (!responseText) return { listingId, entities: null, failed: false };

  return { listingId, entities: parseExtractedEntitiesJson(responseText), failed: false };
}

export function parseEntityBatchOutput(files: string[]): {
  applied: Map<string, QueryEntities>;
  failed: number;
  skipped: number;
} {
  const applied = new Map<string, QueryEntities>();
  let failed = 0;
  let skipped = 0;

  for (const file of files) {
    for (const line of file.split("\n")) {
      if (!line.trim()) continue;
      const parsed = parseEntityBatchOutputLine(line);
      if (!parsed.listingId) {
        skipped += 1;
        continue;
      }
      if (parsed.failed || !parsed.entities) {
        failed += 1;
        continue;
      }
      applied.set(parsed.listingId, parsed.entities);
    }
  }

  return { applied, failed, skipped };
}
