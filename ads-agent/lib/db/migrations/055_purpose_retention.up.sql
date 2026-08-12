BEGIN;

-- Purpose limitation cuts both ways: data kept beyond its stated purpose is unlawful
-- regardless of consent. These are configuration rows, tunable without a migration.
-- Portal spec §10 open question 3 (what is defensible per purpose, against the Rule
-- 8(3) one-year floor) is unresolved by the sources; these are the starting values.
CREATE TABLE IF NOT EXISTS context.purpose_retention (
  purpose        TEXT PRIMARY KEY REFERENCES context.consent_purposes(code),
  retention_days INTEGER NOT NULL,
  rationale      TEXT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE context.purpose_retention DROP CONSTRAINT IF EXISTS purpose_retention_days_positive;
ALTER TABLE context.purpose_retention
  ADD CONSTRAINT purpose_retention_days_positive CHECK (retention_days BETWEEN 1 AND 3650);

INSERT INTO context.purpose_retention (purpose, retention_days, rationale) VALUES
  ('site_analytics',       90,  'Weakest purpose in the catalogue; the product does not need it'),
  ('space_recommendation', 180, 'Two quarters of browsing is enough to recommend against'),
  ('enquiry_handling',     365, 'Rule 8(3) retention floor applies once a session is linked to an enquiry')
ON CONFLICT (purpose) DO UPDATE
  SET retention_days = EXCLUDED.retention_days, rationale = EXCLUDED.rationale, updated_at = now();

COMMIT;
