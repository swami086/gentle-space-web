export type SearchPerformedInput = {
  sessionId: string;
  query: string;
  filters: Record<string, string>;
  resultCount: number;
};

/**
 * Replaces logSearchQuery. The Gentle Space site is itself a portal (dataflow A-2),
 * so its searches go through the same consent-gated edge as any broker's. Soft-fails
 * for the same reason the old writer did: logging must never break search. An event
 * rejected for want of consent is the gate working, not an error.
 */
export async function emitSearchPerformed(input: SearchPerformedInput): Promise<void> {
  const origin = process.env.PORTAL_INGEST_ORIGIN;
  const ingestKey = process.env.GENTLE_SPACE_INGEST_KEY;
  if (!origin || !ingestKey) return;

  try {
    await fetch(`${origin}/api/v1/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ingest-Key": ingestKey,
        Origin: process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "",
      },
      body: JSON.stringify({
        taxonomy_version: 1,
        session_id: input.sessionId,
        events: [
          {
            event: "search_performed",
            occurred_at: new Date().toISOString(),
            payload: {
              query: input.query.slice(0, 500),
              filters: input.filters,
              result_count: input.resultCount,
            },
          },
        ],
      }),
    });
  } catch (err) {
    console.error("portal search event failed", err);
  }
}
