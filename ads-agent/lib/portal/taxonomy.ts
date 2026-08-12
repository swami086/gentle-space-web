import { z } from "zod";

/**
 * Fixed and versioned, one purpose per event (portal spec §6, decision PI4).
 * Arbitrary event shapes make purpose limitation unenforceable: you cannot state a
 * purpose for a payload you have not defined. A version bump requires a new notice,
 * because the notice itemises what is collected.
 */
export const TAXONOMY_VERSION = 1;

export const PURPOSES = ["site_analytics", "space_recommendation", "enquiry_handling"] as const;
export type Purpose = (typeof PURPOSES)[number];

export const EVENT_NAMES = [
  "page_view",
  "listing_view",
  "search_performed",
  "filter_applied",
  "shortlist_added",
  "contact_revealed",
  "enquiry_submitted",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export const EVENT_PURPOSE: Record<EventName, Purpose> = {
  page_view: "site_analytics",
  listing_view: "space_recommendation",
  search_performed: "space_recommendation",
  filter_applied: "space_recommendation",
  shortlist_added: "space_recommendation",
  contact_revealed: "enquiry_handling",
  enquiry_submitted: "enquiry_handling",
};

export function purposeFor(event: EventName): Purpose {
  return EVENT_PURPOSE[event];
}

export const MAX_BODY_BYTES = 8192;
export const MAX_EVENTS_PER_REQUEST = 20;

const EMAIL_SHAPE = /@/;
const PHONE_SHAPE = /\d{10}/;

// A session id containing a phone number or an email makes every "pseudonymous"
// claim in §5 false on arrival, so the shape is enforced rather than trusted.
const sessionId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,64}$/)
  .refine((v) => !EMAIL_SHAPE.test(v) && !PHONE_SHAPE.test(v), {
    message: "session_id must be opaque: no email or phone-shaped content",
  });

const shortText = z.string().max(200);
const filters = z.record(z.string().max(64), z.string().max(200)).refine(
  (value) => Object.keys(value).length <= 20,
  { message: "at most 20 filters" },
);

const event = <N extends EventName, P extends z.ZodTypeAny>(name: N, payload: P) =>
  z.object({
    event: z.literal(name),
    occurred_at: z.string().datetime(),
    payload,
  });

const eventSchema = z.discriminatedUnion("event", [
  event("page_view", z.object({ path: shortText, referrer: shortText })),
  event("listing_view", z.object({ listing_ref: shortText, dwell_seconds: z.number().int().min(0).max(86_400) })),
  event("search_performed", z.object({ query: z.string().max(500), filters, result_count: z.number().int().min(0) })),
  event("filter_applied", z.object({ filters })),
  event("shortlist_added", z.object({ listing_ref: shortText })),
  event("contact_revealed", z.object({ listing_ref: shortText, channel: z.enum(["phone", "email", "whatsapp"]) })),
  event("enquiry_submitted", z.object({ enquiry_ref: z.string().uuid() })),
]);

export const envelopeSchema = z.object({
  taxonomy_version: z.literal(TAXONOMY_VERSION),
  session_id: sessionId,
  events: z.array(eventSchema).min(1).max(MAX_EVENTS_PER_REQUEST),
});

export type PortalEnvelope = z.infer<typeof envelopeSchema>;
export type PortalEvent = z.infer<typeof eventSchema>;
