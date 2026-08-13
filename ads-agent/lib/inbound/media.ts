import type { Scope } from "../db/scope-sql";
import { requireEnv } from "../env";
import { putArtifact as defaultPutArtifact } from "../artifacts/store";

export type InboundMediaItem = {
  source: "whatsapp" | "postmark";
  mediaType: string; // mime
  filenameHint?: string;
  /** WA media id or inline bytes */
  whatsappMediaId?: string;
  bytes?: Uint8Array;
};

const DEFAULT_INBOUND_MEDIA_MAX_BYTES = 25_000_000; // S15-D9: 25 MB default inbound media cap

function getInboundMediaMaxBytesFromEnv(): number {
  const raw = process.env.INBOUND_MEDIA_MAX_BYTES;
  if (!raw) return DEFAULT_INBOUND_MEDIA_MAX_BYTES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_INBOUND_MEDIA_MAX_BYTES;
  }
  return parsed;
}

const WHATSAPP_GRAPH_BASE_URL =
  process.env.WHATSAPP_GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0";

async function defaultFetchWhatsAppMedia(
  mediaId: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const token = requireEnv("WHATSAPP_ACCESS_TOKEN");

  const metaRes = await fetch(
    `${WHATSAPP_GRAPH_BASE_URL}/${encodeURIComponent(mediaId)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!metaRes.ok) {
    throw new Error(
      `WhatsApp media ${mediaId}: metadata fetch failed (${metaRes.status})`,
    );
  }

  const meta = (await metaRes.json()) as {
    url?: string;
    mime_type?: string;
  };
  if (!meta.url) {
    throw new Error(`WhatsApp media ${mediaId}: metadata missing url`);
  }

  const mediaRes = await fetch(meta.url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!mediaRes.ok) {
    throw new Error(
      `WhatsApp media ${mediaId}: download failed (${mediaRes.status})`,
    );
  }

  const bytes = new Uint8Array(await mediaRes.arrayBuffer());
  const mime =
    meta.mime_type ?? mediaRes.headers.get("content-type") ?? "application/octet-stream";

  return { bytes, mime };
}

export type StoreInboundMediaDeps = {
  fetchWhatsAppMedia?: (mediaId: string) => Promise<{ bytes: Uint8Array; mime: string }>;
  putArtifact?: typeof defaultPutArtifact;
  inboundMediaMaxBytes?: number;
};

export async function storeInboundMedia(
  scope: Scope,
  subject: { enquiryId: string; contactId?: string | null },
  items: InboundMediaItem[],
  deps?: StoreInboundMediaDeps,
): Promise<{ artifactIds: string[]; skipped: string[] }> {
  const artifactIds: string[] = [];
  const skipped: string[] = [];

  if (items.length === 0) return { artifactIds, skipped };

  const maxBytes = deps?.inboundMediaMaxBytes ?? getInboundMediaMaxBytesFromEnv();
  const fetchWhatsAppMedia = deps?.fetchWhatsAppMedia ?? defaultFetchWhatsAppMedia;
  const putArtifact = deps?.putArtifact ?? defaultPutArtifact;

  const subjectRefs = [subject.enquiryId, subject.contactId].filter(
    (id): id is string => Boolean(id),
  );

  for (const item of items) {
    let body: Uint8Array | undefined;
    let mediaType = item.mediaType;

    if (item.bytes) {
      body = item.bytes;
    } else if (item.source === "whatsapp" && item.whatsappMediaId) {
      const fetched = await fetchWhatsAppMedia(item.whatsappMediaId);
      body = fetched.bytes;
      mediaType = mediaType || fetched.mime;
    } else {
      // Missing data for this item; record and continue without throwing.
      const label = item.filenameHint ?? item.whatsappMediaId ?? "unknown";
      skipped.push(`missing_body:${item.source}:${label}`);
      continue;
    }

    if (!body) {
      const label = item.filenameHint ?? item.whatsappMediaId ?? "unknown";
      skipped.push(`missing_body:${item.source}:${label}`);
      continue;
    }

    if (body.byteLength > maxBytes) {
      const label = item.whatsappMediaId ?? item.filenameHint ?? "unknown";
      skipped.push(
        `too_large:${label}:${body.byteLength}>${maxBytes}`,
      );
      continue;
    }

    const artifact = await putArtifact(scope, {
      contentType: "inbound_media",
      mediaType: mediaType || "application/octet-stream",
      body,
      subjectRefs,
    });
    artifactIds.push(artifact.id);
  }

  return { artifactIds, skipped };
}

