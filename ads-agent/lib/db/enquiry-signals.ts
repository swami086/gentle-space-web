import { listMessages, type EnquiryMessage } from "./enquiry-messages";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export const SIGNAL_KINDS = [
  "asked_about_pricing",
  "asked_about_availability",
  "mentioned_timeline",
  "mentioned_competitor",
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export type EnquirySignal = {
  orgId: string;
  enquiryId: string;
  kind: SignalKind;
  occurrences: number;
  lastSeenAt: string;
};

type SignalRow = {
  org_id: string;
  enquiry_id: string;
  kind: SignalKind;
  occurrences: number;
  last_seen_at: Date;
};

/**
 * Lexical and deterministic, not an LLM call. "Asked about pricing twice" has
 * to be countable and reproducible; a model that sometimes says three would
 * make the number worse than absent. It is also free, which matters for
 * something recomputed on every inbound message.
 *
 * Until S15 the only inbound channel is the website form, so most enquiries
 * yield one message and therefore single-occurrence signals. The patterns are
 * channel-agnostic, so inbound email and WhatsApp add data without code change.
 */
const PATTERNS: Record<SignalKind, RegExp> = {
  asked_about_pricing: /\b(pric(e|es|ing)|cost|rate|budget|per\s+desk|discount)\b/i,
  asked_about_availability: /\b(availab(le|ility)|vacan(t|cy)|free from|move[-\s]?in|ready)\b/i,
  mentioned_timeline: /\b(next\s+(week|month|quarter)|by\s+\w+|asap|urgent|immediat(e|ely))\b/i,
  mentioned_competitor: /\b(wework|awfis|smartworks|cowrks|91springboard|indiqube|table\s?space)\b/i,
};

function rowToSignal(row: SignalRow): EnquirySignal {
  return {
    orgId: row.org_id,
    enquiryId: row.enquiry_id,
    kind: row.kind,
    occurrences: row.occurrences,
    lastSeenAt: row.last_seen_at.toISOString(),
  };
}

export function deriveSignals(
  messages: EnquiryMessage[],
): { kind: SignalKind; occurrences: number; lastSeenAt: string }[] {
  const found = new Map<SignalKind, { occurrences: number; lastSeenAt: string }>();
  for (const message of messages) {
    for (const kind of SIGNAL_KINDS) {
      // One message counts once per kind, however many times the word appears:
      // "asked twice" means two messages, not two words.
      if (!PATTERNS[kind].test(message.body)) continue;
      const existing = found.get(kind);
      if (!existing) {
        found.set(kind, { occurrences: 1, lastSeenAt: message.receivedAt });
      } else {
        existing.occurrences++;
        if (message.receivedAt > existing.lastSeenAt) existing.lastSeenAt = message.receivedAt;
      }
    }
  }
  return [...found.entries()]
    .map(([kind, value]) => ({ kind, ...value }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

export async function refreshEnquirySignals(
  scope: Scope,
  enquiryId: string,
): Promise<EnquirySignal[]> {
  const orgId = orgIdForWrite(scope);
  const derived = deriveSignals(await listMessages(scope, enquiryId));
  const kinds = derived.map((d) => d.kind);

  return withTenantTransaction(scope, async (c) => {
    // Derived and rebuildable: a signal the current text no longer supports is
    // removed rather than left to accumulate.
    await c.query(
      `DELETE FROM adsagent.enquiry_signals
        WHERE org_id = $1 AND enquiry_id = $2
          AND ($3::text[] IS NULL OR NOT (kind = ANY($3::text[])))`,
      [orgId, enquiryId, kinds.length > 0 ? kinds : null],
    );
    if (derived.length === 0) return [];

    const { rows } = await c.query<SignalRow>(
      `INSERT INTO adsagent.enquiry_signals
         (org_id, enquiry_id, kind, occurrences, last_seen_at)
       SELECT $1, $2, d.kind, d.occurrences, d.last_seen_at
         FROM jsonb_to_recordset($3::jsonb)
              AS d(kind text, occurrences int, last_seen_at timestamptz)
       ON CONFLICT (org_id, enquiry_id, kind) DO UPDATE
         SET occurrences = EXCLUDED.occurrences,
             last_seen_at = EXCLUDED.last_seen_at,
             derived_at = now()
       RETURNING org_id, enquiry_id, kind, occurrences, last_seen_at`,
      [
        orgId,
        enquiryId,
        JSON.stringify(
          derived.map((d) => ({
            kind: d.kind,
            occurrences: d.occurrences,
            last_seen_at: d.lastSeenAt,
          })),
        ),
      ],
    );
    return rows.map(rowToSignal);
  });
}

export async function listSignals(scope: Scope, enquiryId: string): Promise<EnquirySignal[]> {
  const clause = scopeClause(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<SignalRow>(
      `SELECT org_id, enquiry_id, kind, occurrences, last_seen_at
         FROM adsagent.enquiry_signals
        WHERE ${clause.sql} AND enquiry_id = $${clause.params.length + 1}
        ORDER BY occurrences DESC, kind`,
      [...clause.params, enquiryId],
    );
    return rows.map(rowToSignal);
  });
}
