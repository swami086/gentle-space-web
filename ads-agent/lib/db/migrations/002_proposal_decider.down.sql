ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_decided_via_check;
ALTER TABLE public.proposals
  DROP COLUMN IF EXISTS decided_by,
  DROP COLUMN IF EXISTS decided_via;
