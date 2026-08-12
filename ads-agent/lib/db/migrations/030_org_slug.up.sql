BEGIN;

-- Task 11 Step 7 assumed org.slug existed; provisioning had no way to resolve
-- --slug from the database and nothing auto-ran when orgs were seeded.
ALTER TABLE public.orgs ADD COLUMN IF NOT EXISTS slug TEXT;

UPDATE public.orgs SET slug = 'gentle-space'
 WHERE id = '00000000-0000-0000-0000-000000000001' AND slug IS NULL;
UPDATE public.orgs SET slug = 'test-org-a'
 WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND slug IS NULL;
UPDATE public.orgs SET slug = 'test-org-b'
 WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND slug IS NULL;

UPDATE public.orgs
   SET slug = lower(trim(both '-' from regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')))
 WHERE slug IS NULL;

ALTER TABLE public.orgs ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS orgs_slug_key ON public.orgs (slug);

COMMIT;
