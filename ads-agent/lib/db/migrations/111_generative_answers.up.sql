-- Persisted generative surfaces (S13 F5): Ask / Why / call-prep answers
-- scoped per org with pack citation allowlist for reload after refresh.
CREATE TABLE IF NOT EXISTS adsagent.generative_answers (
  id             UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id         UUID NOT NULL REFERENCES public.orgs(id),
  surface        TEXT NOT NULL CHECK (surface IN ('ask', 'why', 'call_prep')),
  subject_type   TEXT NOT NULL,
  subject_id     TEXT NOT NULL,
  pack_row_ids   TEXT[] NOT NULL,
  openui_lang    TEXT NOT NULL,
  follow_ups     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS generative_answers_subject_idx
  ON adsagent.generative_answers (org_id, surface, subject_type, subject_id, created_at DESC);

ALTER TABLE adsagent.generative_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.generative_answers FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON adsagent.generative_answers;
CREATE POLICY tenant_isolation ON adsagent.generative_answers
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());
