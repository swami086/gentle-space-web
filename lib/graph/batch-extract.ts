import { hashEmbeddingTextValue } from "../sync/content-hash";
import { EXTRACT_SYSTEM, parseExtractedEntities } from "./extract";
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

function extractRequestListing(request: unknown): { listingId: string | null; submittedText: string | null } {
  if (!request || typeof request !== "object") {
    return { listingId: null, submittedText: null };
  }
  const contents = (request as { contents?: unknown }).contents;
  if (!Array.isArray(contents) || contents.length === 0) {
    return { listingId: null, submittedText: null };
  }
  const text = readFirstPartText(contents[0]);
  if (!text) return { listingId: null, submittedText: null };
  const firstLineBreak = text.indexOf("\n");
  const prefix = firstLineBreak === -1 ? text : text.slice(0, firstLineBreak);
  const match = LISTING_ID_RE.exec(prefix);
  if (!match) return { listingId: null, submittedText: null };
  return {
    listingId: match[1]?.toLowerCase() ?? null,
    submittedText: firstLineBreak === -1 ? "" : text.slice(firstLineBreak + 1),
  };
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

function parseResponseEntities(responseText: string): QueryEntities | null {
  try {
    return parseExtractedEntities(JSON.parse(responseText));
  } catch {
    return null;
  }
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
  submittedText: string | null;
  submittedHash: string | null;
  entities: QueryEntities | null;
  failed: boolean;
} {
  const trimmed = line.trim();
  if (!trimmed) {
    return { listingId: null, submittedText: null, submittedHash: null, entities: null, failed: false };
  }

  let row: { status?: unknown; request?: unknown; response?: unknown };
  try {
    row = JSON.parse(trimmed) as typeof row;
  } catch {
    return { listingId: null, submittedText: null, submittedHash: null, entities: null, failed: false };
  }

  const { listingId, submittedText } = extractRequestListing(row.request);
  const submittedHash = submittedText === null ? null : hashEmbeddingTextValue(submittedText);
  const status = typeof row.status === "string" ? row.status.trim() : "";
  if (status) return { listingId, submittedText, submittedHash, entities: null, failed: true };

  const responseText = extractResponseText(row.response);
  if (!responseText) return { listingId, submittedText, submittedHash, entities: null, failed: false };

  const entities = parseResponseEntities(responseText);
  if (!entities) return { listingId, submittedText, submittedHash, entities: null, failed: true };

  return { listingId, submittedText, submittedHash, entities, failed: false };
}

export function parseEntityBatchOutput(files: string[]): {
  applied: Map<string, { entities: QueryEntities; submittedText: string; submittedHash: string }>;
  failed: number;
  skipped: number;
} {
  const applied = new Map<string, { entities: QueryEntities; submittedText: string; submittedHash: string }>();
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
      if (parsed.failed || !parsed.entities || parsed.submittedText === null || parsed.submittedHash === null) {
        failed += 1;
        continue;
      }
      applied.set(parsed.listingId, {
        entities: parsed.entities,
        submittedText: parsed.submittedText,
        submittedHash: parsed.submittedHash,
      });
    }
  }

  return { applied, failed, skipped };
}
