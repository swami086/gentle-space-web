BEGIN;

CREATE TABLE context.deletion_requests (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id        public.org_ref NOT NULL REFERENCES public.orgs(id),
  subject_kind  TEXT NOT NULL CHECK (subject_kind IN ('enquirer','user','tenant')),
  subject_ref   TEXT NOT NULL,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Access blocked; user-visible "deleted".
  suppressed_at TIMESTAMPTZ,
  -- requested_at + the DPDP Rule 8(3) one-year retention floor.
  erase_after   DATE NOT NULL,
  erased_at     TIMESTAMPTZ,
  -- Rule 14(3): grievance response within 90 days maximum.
  respond_by    DATE NOT NULL
);

CREATE INDEX deletion_requests_org_subject_idx
  ON context.deletion_requests (org_id, subject_kind, subject_ref);
CREATE INDEX deletion_requests_due_idx ON context.deletion_requests (erase_after)
  WHERE erased_at IS NULL;

-- Per-store propagation. Cascading FK deletes prove nothing to a regulator.
CREATE TABLE context.deletion_propagations (
  request_id  UUID NOT NULL REFERENCES context.deletion_requests(id) ON DELETE CASCADE,
  store       TEXT NOT NULL CHECK (store IN
                ('postgres','clickhouse','duckdb_snapshot','graph','twenty',
                 'vector_index','objectstore','langfuse','clickhouse_raw')),
  state       TEXT NOT NULL DEFAULT 'pending'
                CHECK (state IN ('pending','suppressed','erased','failed')),
  detail      TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, store)
);

-- No foreign key on org_id: an audit row must survive the deletion of
-- everything it refers to.
CREATE TABLE context.access_log (
  id            UUID NOT NULL DEFAULT uuidv7(),
  org_id        UUID NOT NULL,
  actor_kind    TEXT NOT NULL CHECK (actor_kind IN ('user','agent','system','cross_tenant')),
  actor_ref     TEXT NOT NULL,
  subject_kind  TEXT,
  subject_ref   TEXT,
  action        TEXT NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE context.access_log_2026_08 PARTITION OF context.access_log
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE context.access_log_2026_09 PARTITION OF context.access_log
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE context.access_log_2026_10 PARTITION OF context.access_log
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
-- A missing partition would make an INSERT fail, which would turn an audit
-- gap into an outage. The default partition absorbs anything unrouted; an
-- alert on non-empty default is the signal to add the next month.
CREATE TABLE context.access_log_default PARTITION OF context.access_log DEFAULT;

CREATE INDEX access_log_org_occurred_idx ON context.access_log (org_id, occurred_at DESC);
CREATE INDEX access_log_subject_idx ON context.access_log (org_id, subject_kind, subject_ref);

ALTER TABLE context.deletion_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.deletion_requests     FORCE  ROW LEVEL SECURITY;
ALTER TABLE context.access_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE context.access_log            FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON context.deletion_requests
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

CREATE POLICY cross_tenant_read ON context.deletion_requests
  FOR SELECT
  USING (current_setting('app.cross_tenant', true) = 'projector');

CREATE POLICY tenant_isolation ON context.access_log
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

-- A declared cross-tenant actor has no tenant set, and must still be able to
-- record that it read across tenants. Insert-only: it can write its own audit
-- trail and read nothing.
CREATE POLICY cross_tenant_audit ON context.access_log
  FOR INSERT
  WITH CHECK (current_setting('app.cross_tenant', true) = 'projector');

-- deletion_propagations carries no org_id of its own; it is reachable only
-- through an RLS-protected request row, so it inherits isolation by reference.
COMMIT;
