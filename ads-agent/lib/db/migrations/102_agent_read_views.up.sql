-- S9 Task 3: tenant-scoped read views for the MCP context server.
-- security_invoker keeps FORCE RLS on base tables; agent_ro needs schema USAGE
-- and SELECT on those bases because invoker rights apply (migration 100 revoked all).
BEGIN;

-- B6: S9 owns evidence; Task 7 list_proposals needs it before Task 8/104.
ALTER TABLE adsagent.proposals
  ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '[]';

GRANT USAGE ON SCHEMA adsagent, listings TO agent_ro;

GRANT SELECT ON
  adsagent.enquiries,
  adsagent.enquiry_activities,
  adsagent.proposals,
  adsagent.campaigns
TO agent_ro;

GRANT SELECT ON
  listings.listings,
  listings.listing_corridors
TO agent_ro;

CREATE OR REPLACE VIEW context.v_agent_enquiries
  WITH (security_invoker = true) AS
SELECT e.id,
       e.org_id,
       e.contact_name,
       e.reply_state,
       e.corridor_id,
       e.listing_id,
       e.first_seen_at,
       e.last_activity_at
  FROM adsagent.enquiries e
 WHERE e.org_id = public.current_tenant()
   AND e.lifecycle = 'active';

CREATE OR REPLACE VIEW context.v_agent_enquiry_activity
  WITH (security_invoker = true) AS
SELECT a.id,
       a.org_id,
       a.enquiry_id,
       a.kind,
       a.occurred_at,
       a.body AS summary
  FROM adsagent.enquiry_activities a
 WHERE a.org_id = public.current_tenant();

CREATE OR REPLACE VIEW context.v_agent_spaces
  WITH (security_invoker = true) AS
SELECT l.id,
       public.current_tenant() AS org_id,
       l.title AS name,
       lc.corridor_id,
       NULL::integer AS desks,
       NULL::numeric AS price_per_desk,
       l.amenities,
       l.synced_at AS updated_at
  FROM listings.listings l
  LEFT JOIN (
    SELECT DISTINCT ON (listing_id) listing_id, corridor_id
      FROM listings.listing_corridors
     ORDER BY listing_id, confidence DESC
  ) lc ON lc.listing_id = l.id
 WHERE EXISTS (
         SELECT 1
           FROM adsagent.enquiries e
          WHERE e.org_id = public.current_tenant()
            AND e.lifecycle = 'active'
            AND e.listing_id = l.id
       )
    OR EXISTS (
         SELECT 1
           FROM adsagent.campaigns c
           JOIN listings.listing_corridors lcc
             ON lcc.corridor_id = c.corridor_id
          WHERE c.org_id = public.current_tenant()
            AND c.corridor_id IS NOT NULL
            AND lcc.listing_id = l.id
       );

CREATE OR REPLACE VIEW context.v_agent_proposals
  WITH (security_invoker = true) AS
SELECT p.id,
       p.org_id,
       p.kind,
       p.status,
       p.rationale,
       p.evidence,
       p.created_at,
       p.decided_at
  FROM adsagent.proposals p
 WHERE p.org_id = public.current_tenant();

CREATE OR REPLACE VIEW context.v_agent_campaigns
  WITH (security_invoker = true) AS
SELECT c.id,
       c.org_id,
       c.name,
       c.platform,
       c.status,
       c.corridor,
       c.daily_budget
  FROM adsagent.campaigns c
 WHERE c.org_id = public.current_tenant();

GRANT SELECT ON context.v_agent_enquiries         TO agent_ro;
GRANT SELECT ON context.v_agent_enquiry_activity  TO agent_ro;
GRANT SELECT ON context.v_agent_spaces            TO agent_ro;
GRANT SELECT ON context.v_agent_proposals         TO agent_ro;
GRANT SELECT ON context.v_agent_campaigns         TO agent_ro;

COMMIT;
