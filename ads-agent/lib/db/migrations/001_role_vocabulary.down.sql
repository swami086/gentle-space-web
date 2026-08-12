ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE public.users SET role = 'member' WHERE role IN ('operator','viewer');
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (role IN ('admin','member'));
ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'member';
