BEGIN;

-- The catalogue is fixed by us, never by the broker: an event type maps to exactly
-- one purpose so the ingestion gate can decide mechanically. Reference data, shared
-- across tenants, therefore no org_id and no RLS (same shape as public.corridors).
CREATE TABLE IF NOT EXISTS context.consent_purposes (
  code        TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

INSERT INTO context.consent_purposes (code, description) VALUES
  ('site_analytics',       'Aggregate page and traffic analytics for the broker''s own site'),
  ('space_recommendation', 'Recommending spaces based on browsing, searching and shortlisting'),
  ('enquiry_handling',     'Responding to and working an enquiry the visitor submitted')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

COMMIT;
