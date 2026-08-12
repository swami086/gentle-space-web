-- Null engine: rows are discarded, but attached materialized views still fire, so the
-- transform in 004 is exercised locally with no cloud credentials and no second copy.
CREATE TABLE IF NOT EXISTS raw.portal_event_ingest (raw String) ENGINE = Null;
