import { randomUUID } from "node:crypto";
import { enqueueEvent } from "../db/outbox";
import type { Scope } from "../db/scope-sql";
import { withTenantTransaction } from "../db/tx";
import { originAllowed, PLATFORM_SCOPE, resolveIngestKey } from "./config";
import { ensureConsentInvalidator, getConsentStateCached } from "./consent-cache";
import { checkRateLimit } from "./rate-limit";
import { recordRejection, startRejectionFlush, type RejectionReason } from "./rejections";
import { linkSession } from "./session-links";
import { envelopeSchema, MAX_BODY_BYTES, purposeFor } from "./taxonomy";

export type IngestInput = { body: string; ingestKey: string | null; origin: string | null };
export type IngestOutcome =
  | { ok: true; accepted: number; eventIds: string[] }
  | { ok: false; status: 400 | 403 | 404 | 413 | 429; reason: RejectionReason };

function reject(
  orgId: string | null,
  status: 400 | 403 | 404 | 413 | 429,
  reason: RejectionReason,
): IngestOutcome {
  recordRejection(orgId, reason);
  return { ok: false, status, reason };
}

export async function ingest(input: IngestInput): Promise<IngestOutcome> {
  startRejectionFlush();

  // Cheapest checks first: nothing below costs a database round trip until the key
  // lookup, and nothing costs storage until the publish.
  if (Buffer.byteLength(input.body, "utf8") > MAX_BODY_BYTES) return reject(null, 413, "too_large");
  if (!input.ingestKey) return reject(null, 404, "unknown_key");

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body);
  } catch {
    return reject(null, 400, "invalid_json");
  }

  const envelope = envelopeSchema.safeParse(parsed);
  if (!envelope.success) return reject(null, 400, "invalid_shape");

  if (!checkRateLimit(input.ingestKey, envelope.data.session_id)) return reject(null, 429, "rate_limited");

  const config = await resolveIngestKey(PLATFORM_SCOPE, input.ingestKey);
  if (!config) return reject(null, 404, "unknown_key");
  if (!originAllowed(input.origin, config.allowedOrigins)) {
    return reject(config.orgId, 403, "origin_not_allowed");
  }

  const scope: Scope = { kind: "org", orgId: config.orgId };
  await ensureConsentInvalidator();
  const consent = await getConsentStateCached(scope, config.orgId, envelope.data.session_id);

  const permitted = envelope.data.events.filter((event) => {
    const purpose = purposeFor(event.event);
    return config.purposesOffered.includes(purpose) && consent.purposes.includes(purpose);
  });

  if (permitted.length === 0) return reject(config.orgId, 403, "no_consent");
  if (permitted.length < envelope.data.events.length) recordRejection(config.orgId, "no_consent");

  const eventIds = await withTenantTransaction(scope, async (client) => {
    const ids: string[] = [];
    for (const event of permitted) {
      const eventId = randomUUID();
      ids.push(eventId);
      await enqueueEvent(scope, client, {
        topic: "portal.event",
        payload: {
          event_id: eventId,
          org_id: config.orgId,
          event: event.event,
          purpose: purposeFor(event.event),
          session_id: envelope.data.session_id,
          taxonomy_version: envelope.data.taxonomy_version,
          occurred_at: event.occurred_at,
          payload: event.payload,
        },
      });

      if (event.event === "enquiry_submitted") {
        await linkSession(
          scope,
          { sessionId: envelope.data.session_id, enquiryId: event.payload.enquiry_ref },
          client,
        );
      }
    }
    return ids;
  });

  return { ok: true, accepted: permitted.length, eventIds };
}
