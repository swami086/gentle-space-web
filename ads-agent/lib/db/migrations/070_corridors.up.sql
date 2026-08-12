-- Reference data shared across tenants: deliberately NOT org_id-scoped and therefore
-- not RLS-protected (data model §4). `aliases` is what makes lexical matching work.
BEGIN;

CREATE TABLE IF NOT EXISTS public.corridors (
  id           UUID PRIMARY KEY DEFAULT uuidv7(),
  slug         TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  city         TEXT NOT NULL DEFAULT 'Bangalore',
  parent_id    UUID REFERENCES public.corridors(id),
  aliases      TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS corridors_city_slug_idx ON public.corridors (city, slug);

INSERT INTO public.corridors (slug, display_name, aliases) VALUES
  ('outer-ring-road', 'Outer Ring Road', ARRAY['ORR','Outer Ring Rd'])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.corridors (slug, display_name, aliases) VALUES
  ('hsr-layout',      'HSR Layout',      ARRAY['HSR','Hosur Sarjapur Road','HSR Sector']),
  ('koramangala',     'Koramangala',     ARRAY['Koramangla','KRMNGLA']),
  ('indiranagar',     'Indiranagar',     ARRAY['Indira Nagar']),
  ('whitefield',      'Whitefield',      ARRAY['ITPL','Whitefield Main Road']),
  ('electronic-city', 'Electronic City', ARRAY['E City','Electronics City','Ecity']),
  ('cbd-mg-road',     'CBD - MG Road',   ARRAY['MG Road','Mahatma Gandhi Road','Central Business District','CBD']),
  ('jp-nagar',        'JP Nagar',        ARRAY['Jayaprakash Narayan Nagar','J P Nagar']),
  ('jayanagar',       'Jayanagar',       ARRAY['Jaya Nagar']),
  ('sarjapur-road',   'Sarjapur Road',   ARRAY['Sarjapura Road','Sarjapur Main Road']),
  ('hebbal',          'Hebbal',          ARRAY['Hebbal Kempapura']),
  ('yeshwanthpur',    'Yeshwanthpur',    ARRAY['Yeshwantpur','Yashwantpur']),
  ('banashankari',    'Banashankari',    ARRAY['BSK']),
  ('domlur',          'Domlur',          ARRAY['Domlur Layout']),
  ('rajajinagar',     'Rajajinagar',     ARRAY['Rajaji Nagar']),
  ('kalyan-nagar',    'Kalyan Nagar',    ARRAY['Kalyannagar','HRBR Layout'])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.corridors (slug, display_name, parent_id, aliases)
SELECT v.slug, v.display_name, p.id, v.aliases
  FROM (VALUES
    ('orr-bellandur',    'Outer Ring Road - Bellandur',    ARRAY['Bellandur','ORR Bellandur']),
    ('orr-marathahalli', 'Outer Ring Road - Marathahalli', ARRAY['Marathahalli','Marathalli','ORR Marathahalli'])
  ) AS v(slug, display_name, aliases)
  CROSS JOIN (SELECT id FROM public.corridors WHERE slug = 'outer-ring-road') p
ON CONFLICT (slug) DO NOTHING;

COMMENT ON TABLE public.corridors IS
  'Controlled corridor vocabulary. Shared reference data, not tenant-scoped. There is deliberately no catch-all corridor: unmatched listings and campaigns are counted as residual, not bucketed.';

COMMIT;
