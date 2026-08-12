BEGIN;

CREATE TABLE IF NOT EXISTS context.consent_records (
  id             UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id         public.org_ref NOT NULL REFERENCES public.orgs(id),
  subject_ref    TEXT NOT NULL,               -- session id, or enquiry id once linked
  purposes       TEXT[] NOT NULL,
  action         TEXT NOT NULL,
  notice_version INTEGER NOT NULL,
  mechanism      TEXT NOT NULL,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE context.consent_records DROP CONSTRAINT IF EXISTS consent_records_action_check;
ALTER TABLE context.consent_records
  ADD CONSTRAINT consent_records_action_check CHECK (action IN ('granted','withdrawn'));

ALTER TABLE context.consent_records DROP CONSTRAINT IF EXISTS consent_records_mechanism_check;
ALTER TABLE context.consent_records
  ADD CONSTRAINT consent_records_mechanism_check CHECK (mechanism IN ('banner','form','consent_manager'));

ALTER TABLE context.consent_records DROP CONSTRAINT IF EXISTS consent_records_purposes_in_catalogue;
ALTER TABLE context.consent_records
  ADD CONSTRAINT consent_records_purposes_in_catalogue CHECK (
    cardinality(purposes) > 0
    AND purposes <@ ARRAY['site_analytics','space_recommendation','enquiry_handling']::TEXT[]
  );

CREATE INDEX IF NOT EXISTS consent_records_lookup_idx
  ON context.consent_records (org_id, subject_ref, occurred_at DESC);

ALTER TABLE context.consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.consent_records FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON context.consent_records;
CREATE POLICY tenant_isolation ON context.consent_records
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- Withdrawal is a new row, never an update: you must be able to show what was true
-- at the moment an event was collected. Consent records also survive the erasure of
-- the data they authorised (Rule 8(3)), so there is no legitimate DELETE either.
CREATE OR REPLACE FUNCTION context.reject_consent_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'context.consent_records is append-only; record a withdrawal instead';
END;
$$;

DROP TRIGGER IF EXISTS consent_records_append_only ON context.consent_records;
CREATE TRIGGER consent_records_append_only
  BEFORE UPDATE OR DELETE ON context.consent_records
  FOR EACH ROW EXECUTE FUNCTION context.reject_consent_mutation();

-- A withdrawal must take effect in seconds, not at the next cache expiry. The
-- notification is delivered on commit, so no listener can act on an uncommitted row.
CREATE OR REPLACE FUNCTION context.notify_consent_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('consent_changed', NEW.org_id::text || ':' || NEW.subject_ref);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS consent_records_notify ON context.consent_records;
CREATE TRIGGER consent_records_notify
  AFTER INSERT ON context.consent_records
  FOR EACH ROW EXECUTE FUNCTION context.notify_consent_change();

COMMIT;
