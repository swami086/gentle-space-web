BEGIN;

-- Inbound only. Outbound is voice; there is no send path (BD2).
CREATE TABLE adsagent.enquiry_messages (
  id             UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id         public.org_ref NOT NULL REFERENCES public.orgs(id),
  enquiry_id     UUID NOT NULL REFERENCES adsagent.enquiries(id) ON DELETE CASCADE,

  channel        TEXT NOT NULL CHECK (channel IN ('web_form','email','whatsapp')),
  direction      TEXT NOT NULL DEFAULT 'inbound' CHECK (direction = 'inbound'),
  body           TEXT NOT NULL,
  external_id    TEXT,   -- provider message id, for dedupe
  reply_token     TEXT,  -- how an inbound email threads back (S15)

  -- Untrusted content. Agents reading this must treat it as tainted.
  is_untrusted   BOOLEAN NOT NULL DEFAULT true,

  received_at    TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT enquiry_messages_external_unique UNIQUE (org_id, channel, external_id)
);

CREATE INDEX enquiry_messages_org_enquiry_idx
  ON adsagent.enquiry_messages (org_id, enquiry_id, received_at DESC);

ALTER TABLE adsagent.enquiry_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.enquiry_messages FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.enquiry_messages
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());

COMMIT;
