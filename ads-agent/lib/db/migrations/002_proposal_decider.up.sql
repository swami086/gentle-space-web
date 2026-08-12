-- F-7: the human-gated approval workflow recorded no human.
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS decided_by  UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS decided_via TEXT;

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_decided_via_check;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_decided_via_check
  CHECK (decided_via IS NULL OR decided_via IN ('ui','bulk','api','system'));
