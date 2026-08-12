-- F-2: schema.sql permitted only admin|member while lib/auth/dal.ts expects
-- admin|operator|viewer, so two of three roles could not be stored at all and a
-- stored 'member' resolved to undefined in ROLE_RANK.
-- No BEGIN/COMMIT: lib/db/migrate.ts wraps every migration in one transaction.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;

-- 'member' has no equivalent in the code's vocabulary. 'operator' is the closest
-- existing meaning: can act, cannot administer. Preserves today's capability.
UPDATE public.users SET role = 'operator' WHERE role = 'member';

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (role IN ('admin','operator','viewer'));

-- Least privilege by default: a newly shadowed user can read until promoted.
ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'viewer';
