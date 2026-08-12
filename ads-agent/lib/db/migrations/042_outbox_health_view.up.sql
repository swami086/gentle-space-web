-- S5a: one view answering every outbox signal from datastore spec §12.4.
-- One query per signal was four round trips and four chances to disagree.
BEGIN;

-- security_invoker so the querying role's RLS applies rather than the view
-- owner's. Without it this view would be a hole straight through tenant
-- isolation for anyone granted SELECT on it.
CREATE VIEW context.outbox_health WITH (security_invoker = true) AS
SELECT
  count(*) FILTER (WHERE published_at IS NULL)                            AS unpublished_count,
  coalesce(
    max(EXTRACT(EPOCH FROM (now() - created_at))) FILTER (WHERE published_at IS NULL),
    0)::bigint                                                            AS oldest_unpublished_seconds,
  count(*) FILTER (WHERE published_at IS NULL AND topic = 'deletion.requested')
                                                                          AS unpublished_deletion_count,
  coalesce(
    max(EXTRACT(EPOCH FROM (now() - created_at)))
      FILTER (WHERE published_at IS NULL AND topic = 'deletion.requested'),
    0)::bigint                                                            AS oldest_unpublished_deletion_seconds,
  count(*) FILTER (WHERE published_at IS NULL AND attempts >= 5)          AS stuck_count
FROM context.outbox_events;

GRANT SELECT ON context.outbox_health TO outbox_relay;

-- Retention (data model §5a) runs as the relay role, which migration 041 gave
-- only SELECT and UPDATE. Pruning published rows needs DELETE, and it is granted
-- here rather than in 041 because retention is this migration's deliverable.
GRANT DELETE ON context.outbox_events TO outbox_relay;

COMMIT;
