BEGIN;

CREATE TABLE IF NOT EXISTS derived.corridor_attribution_daily (
  id                   UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id               public.org_ref NOT NULL REFERENCES public.orgs(id),
  corridor_id          UUID REFERENCES public.corridors(id),
  window_start         DATE NOT NULL,
  window_end           DATE NOT NULL,
  window_state         TEXT NOT NULL CHECK (window_state IN ('open','closed')),
  spend_inr            NUMERIC(18,4) NOT NULL CHECK (spend_inr >= 0),
  enquiry_count        INTEGER       NOT NULL CHECK (enquiry_count >= 0),
  cost_per_enquiry_inr NUMERIC(18,4),
  late_enquiry_count   INTEGER       NOT NULL DEFAULT 0 CHECK (late_enquiry_count >= 0),
  computed_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  source_watermark     TIMESTAMPTZ   NOT NULL,
  cdc_lag_seconds      INTEGER       NOT NULL CHECK (cdc_lag_seconds >= 0),
  CONSTRAINT corridor_attribution_window_ordered CHECK (window_end >= window_start),
  CONSTRAINT corridor_attribution_cost_is_real
    CHECK ((enquiry_count = 0) = (cost_per_enquiry_inr IS NULL)),
  CONSTRAINT corridor_attribution_unique
    UNIQUE NULLS NOT DISTINCT (org_id, corridor_id, window_start, window_end)
);

CREATE INDEX IF NOT EXISTS corridor_attribution_org_window_idx
  ON derived.corridor_attribution_daily (org_id, window_start DESC, window_end DESC);

CREATE TABLE IF NOT EXISTS derived.attribution_reconciliation (
  id                            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id                        public.org_ref NOT NULL REFERENCES public.orgs(id),
  window_start                  DATE NOT NULL,
  window_end                    DATE NOT NULL,
  window_state                  TEXT NOT NULL CHECK (window_state IN ('open','closed')),
  total_spend_inr               NUMERIC(18,4) NOT NULL CHECK (total_spend_inr >= 0),
  total_enquiry_count           INTEGER       NOT NULL CHECK (total_enquiry_count >= 0),
  unattributed_spend_inr        NUMERIC(18,4) NOT NULL CHECK (unattributed_spend_inr >= 0),
  unattributed_enquiry_count    INTEGER       NOT NULL CHECK (unattributed_enquiry_count >= 0),
  spend_without_enquiries_inr   NUMERIC(18,4) NOT NULL CHECK (spend_without_enquiries_inr >= 0),
  enquiries_without_spend_count INTEGER       NOT NULL CHECK (enquiries_without_spend_count >= 0),
  late_enquiry_count            INTEGER       NOT NULL DEFAULT 0 CHECK (late_enquiry_count >= 0),
  computed_at                   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  source_watermark              TIMESTAMPTZ   NOT NULL,
  cdc_lag_seconds               INTEGER       NOT NULL CHECK (cdc_lag_seconds >= 0),
  CONSTRAINT attribution_reconciliation_residual_fits
    CHECK (unattributed_spend_inr <= total_spend_inr
       AND unattributed_enquiry_count <= total_enquiry_count),
  CONSTRAINT attribution_reconciliation_unique
    UNIQUE (org_id, window_start, window_end)
);

CREATE INDEX IF NOT EXISTS attribution_reconciliation_org_window_idx
  ON derived.attribution_reconciliation (org_id, window_start DESC);

ALTER TABLE derived.corridor_attribution_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE derived.corridor_attribution_daily FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON derived.corridor_attribution_daily;
CREATE POLICY tenant_isolation ON derived.corridor_attribution_daily
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

ALTER TABLE derived.attribution_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE derived.attribution_reconciliation FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON derived.attribution_reconciliation;
CREATE POLICY tenant_isolation ON derived.attribution_reconciliation
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON derived.corridor_attribution_daily TO derived_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON derived.attribution_reconciliation TO derived_rw;
GRANT SELECT ON derived.corridor_attribution_daily   TO adsagent_rw;
GRANT SELECT ON derived.attribution_reconciliation   TO adsagent_rw;

COMMENT ON TABLE derived.corridor_attribution_daily IS
  'QUARANTINE. Projection of a ClickHouse rollup. Truncatable and rebuildable at any time, never the input to another derivation, and never the sole justification for a proposal (dataflow review A-5).';
COMMENT ON TABLE derived.attribution_reconciliation IS
  'QUARANTINE. Per-window residual: spend and enquiries that could not be attributed to a corridor, reported as their own figures rather than spread across corridors.';
COMMENT ON COLUMN derived.corridor_attribution_daily.late_enquiry_count IS
  'Enquiries that arrived after the window closed. Never folded into cost_per_enquiry_inr: closed figures are frozen.';

COMMIT;
