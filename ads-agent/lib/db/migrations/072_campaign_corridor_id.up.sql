-- adsagent.campaigns.corridor is dead TEXT (backend spec BD7). Add the real key and
-- backfill from the free text. The TEXT column stays: lib/db/dashboard.ts still selects
-- it, and its removal is a separate cleanup outside S7.
BEGIN;

ALTER TABLE adsagent.campaigns
  ADD COLUMN IF NOT EXISTS corridor_id UUID REFERENCES public.corridors(id);

CREATE INDEX IF NOT EXISTS campaigns_org_corridor_idx
  ON adsagent.campaigns (org_id, corridor_id);

UPDATE adsagent.campaigns ca
   SET corridor_id = c.id
  FROM public.corridors c
 WHERE ca.corridor_id IS NULL
   AND ca.corridor IS NOT NULL
   AND lower(btrim(ca.corridor)) IN (lower(c.display_name), lower(c.slug));

UPDATE adsagent.campaigns ca
   SET corridor_id = c.id
  FROM public.corridors c
 WHERE ca.corridor_id IS NULL
   AND ca.corridor IS NOT NULL
   AND EXISTS (
         SELECT 1 FROM unnest(c.aliases) AS a
          WHERE lower(ca.corridor) LIKE '%' || lower(a) || '%'
       );

COMMENT ON COLUMN adsagent.campaigns.corridor IS
  'Legacy free-text corridor. Superseded by corridor_id (migration 072). Read for display only until S7 Task 9 repoints dashboard.ts; do not write.';

COMMIT;
