import type { InboundEvent } from "../db/inbound-events";
import {
  markInboundEventFailed as defaultMarkInboundEventFailed,
  markInboundEventProcessed as defaultMarkInboundEventProcessed,
} from "../db/inbound-events";
import { addMessage as defaultAddMessage } from "../db/enquiry-messages";
import { refreshEnquirySignals as defaultRefreshEnquirySignals } from "../db/enquiry-signals";
import { touchLastActivity as defaultTouchLastActivity } from "../db/enquiries";
import type { Scope } from "../db/scope-sql";
import {
  matchOrCreateEnquiry as defaultMatchOrCreateEnquiry,
  type MatchInput,
} from "./match";
import {
  storeInboundMedia as defaultStoreInboundMedia,
  type InboundMediaItem,
  type StoreInboundMediaDeps,
} from "./media";

export type ProcessInboundEventDeps = {
  matchOrCreateEnquiry?: typeof defaultMatchOrCreateEnquiry;
  storeInboundMedia?: typeof defaultStoreInboundMedia;
  storeInboundMediaDeps?: StoreInboundMediaDeps;
  addMessage?: typeof defaultAddMessage;
  refreshEnquirySignals?: typeof defaultRefreshEnquirySignals;
  touchLastActivity?: typeof defaultTouchLastActivity;
  markInboundEventProcessed?: typeof defaultMarkInboundEventProcessed;
  markInboundEventFailed?: typeof defaultMarkInboundEventFailed;
};

type ParsedInbound = {
  matchInput: MatchInput;
  mediaItems: InboundMediaItem[];
  textBody: string | null;
  mediaPlaceholder: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function decodeBase64(content: string): Uint8Array {
  return Uint8Array.from(Buffer.from(content, "base64"));
}

function parseWhatsAppPayload(payload: Record<string, unknown>): ParsedInbound {
  const fromPhoneRaw = readString(payload.from) ?? "";
  const type = readString(payload.type) ?? "unknown";
  const textBody = readString(asRecord(payload.text)?.body);

  const mediaItems: InboundMediaItem[] = [];
  let mediaPlaceholder: string | null = null;

  const mediaTypes = ["image", "document", "audio", "video"] as const;
  for (const mediaType of mediaTypes) {
    if (type !== mediaType) continue;
    const media = asRecord(payload[mediaType]);
    const mediaId = readString(media?.id);
    if (mediaId) {
      mediaItems.push({
        source: "whatsapp",
        mediaType: readString(media?.mime_type) ?? `${mediaType}/*`,
        whatsappMediaId: mediaId,
        filenameHint: readString(media?.filename) ?? undefined,
      });
    }
    if (mediaType === "document") {
      const filename = readString(media?.filename);
      mediaPlaceholder = filename ? `[document: ${filename}]` : "[document]";
    } else {
      mediaPlaceholder = `[${mediaType}]`;
    }
    break;
  }

  return {
    matchInput: {
      channel: "whatsapp",
      fromPhoneRaw,
      profileName: null,
    },
    mediaItems,
    textBody,
    mediaPlaceholder,
  };
}

function parseEmailPayload(payload: Record<string, unknown>): ParsedInbound {
  const fromFull = asRecord(payload.FromFull);
  const fromEmail =
    readString(fromFull?.Email) ?? readString(payload.From) ?? "unknown@example.com";
  const fromName =
    readString(fromFull?.Name) ?? readString(payload.FromName) ?? fromEmail;
  const mailboxHash = readString(payload.MailboxHash);
  const textBody = readString(payload.TextBody);

  const mediaItems: InboundMediaItem[] = [];
  const attachments = Array.isArray(payload.Attachments) ? payload.Attachments : [];
  for (const attachment of attachments) {
    const att = asRecord(attachment);
    const content = readString(att?.Content);
    if (!content) continue;
    mediaItems.push({
      source: "postmark",
      mediaType: readString(att?.ContentType) ?? "application/octet-stream",
      bytes: decodeBase64(content),
      filenameHint: readString(att?.Name) ?? undefined,
    });
  }

  return {
    matchInput: {
      channel: "email",
      mailboxHash,
      fromName,
      fromEmail,
    },
    mediaItems,
    textBody,
    mediaPlaceholder: mediaItems.length > 0 ? "[attachment]" : null,
  };
}

function parseInboundPayload(event: InboundEvent): ParsedInbound {
  if (event.channel === "whatsapp") {
    return parseWhatsAppPayload(event.payload);
  }
  return parseEmailPayload(event.payload);
}

function buildMessageBody(
  parsed: ParsedInbound,
  skipped: string[],
): string {
  const parts: string[] = [];
  if (parsed.textBody) {
    parts.push(parsed.textBody);
  } else if (parsed.mediaPlaceholder) {
    parts.push(parsed.mediaPlaceholder);
  }

  for (const note of skipped) {
    if (note.startsWith("too_large:")) {
      parts.push("[media skipped: too large]");
    } else {
      parts.push(`[media skipped: ${note}]`);
    }
  }

  return parts.join("\n").trim() || "[empty message]";
}

export async function processInboundEvent(
  event: InboundEvent,
  deps?: ProcessInboundEventDeps,
): Promise<void> {
  const scope: Scope = { kind: "org", orgId: event.orgId };
  const matchOrCreateEnquiry = deps?.matchOrCreateEnquiry ?? defaultMatchOrCreateEnquiry;
  const storeInboundMedia = deps?.storeInboundMedia ?? defaultStoreInboundMedia;
  const addMessage = deps?.addMessage ?? defaultAddMessage;
  const refreshEnquirySignals =
    deps?.refreshEnquirySignals ?? defaultRefreshEnquirySignals;
  const touchLastActivity = deps?.touchLastActivity ?? defaultTouchLastActivity;
  const markInboundEventProcessed =
    deps?.markInboundEventProcessed ?? defaultMarkInboundEventProcessed;
  const markInboundEventFailed =
    deps?.markInboundEventFailed ?? defaultMarkInboundEventFailed;

  try {
    const parsed = parseInboundPayload(event);
    const { enquiry, contact } = await matchOrCreateEnquiry(scope, parsed.matchInput);

    let mediaResult: { artifactIds: string[]; skipped: string[] };
    try {
      mediaResult = await storeInboundMedia(
        scope,
        { enquiryId: enquiry.id, contactId: contact?.id ?? null },
        parsed.mediaItems,
        deps?.storeInboundMediaDeps,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markInboundEventFailed(scope, event.id, message);
      return;
    }

    const body = buildMessageBody(parsed, mediaResult.skipped);

    await addMessage(scope, {
      enquiryId: enquiry.id,
      channel: event.channel,
      body,
      externalId: event.externalId,
      replyToken: enquiry.inboundReplyToken,
    });

    await refreshEnquirySignals(scope, enquiry.id);
    await touchLastActivity(scope, enquiry.id);
    await markInboundEventProcessed(scope, event.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markInboundEventFailed(scope, event.id, message);
  }
}
