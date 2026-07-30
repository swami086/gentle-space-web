-- Sample listings for local /spaces UI smoke (no secrets).
-- Apply after schema: psql "$DATABASE_URL" -f lib/db/schema.sql -f scripts/seed-listings-sample.sql

INSERT INTO listings (
  id, source, source_id, slug, title, description, short_teaser,
  address, area, city, lat, lng, amenities, images,
  pricing_hint, property_type, source_url, synced_at, last_seen_at
) VALUES
  (
    'a1111111-1111-4111-8111-111111111101',
    'coworker',
    'cowrks-ecoworld',
    'coworker-cowrks-ecoworld',
    'CoWrks Ecoworld',
    'Premium coworking in Bellandur with meeting rooms, breakout zones, and 24/7 access.',
    'Premium coworking in Bellandur',
    'Ecoworld Campus, Bellandur',
    'Bellandur',
    'Bengaluru',
    12.9279,
    77.6784,
    '["WiFi", "Meeting rooms", "Parking"]'::jsonb,
    '["https://example.com/images/cowrks-ecoworld.jpg"]'::jsonb,
    'From ₹8,000/seat',
    'Coworking',
    'https://www.coworker.com/india/bengaluru/cowrks-ecoworld',
    '2026-07-23T12:00:00Z',
    '2026-07-23T12:00:00Z'
  ),
  (
    'a1111111-1111-4111-8111-111111111102',
    'myhq',
    'wework-prestige-atlanta',
    'myhq-wework-prestige-atlanta',
    'WeWork Prestige Atlanta',
    'Flexible desks and private cabins near MG Road with high-speed internet and pantry.',
    'Flexible desks near MG Road',
    'Prestige Atlanta, MG Road',
    'MG Road',
    'Bengaluru',
    12.9756,
    77.6064,
    '["WiFi", "Pantry", "Reception"]'::jsonb,
    '["https://example.com/images/wework-prestige-atlanta.jpg"]'::jsonb,
    'From ₹6,500/seat',
    'Coworking',
    'https://myhq.in/dedicated/coworking-space/wework-prestige-atlanta',
    '2026-07-23T12:00:00Z',
    '2026-07-23T12:00:00Z'
  ),
  (
    'a1111111-1111-4111-8111-111111111103',
    'cofynd',
    'workhome',
    'cofynd-workhome',
    'WorkHome Koramangala',
    'Boutique coworking space with natural light, phone booths, and community events.',
    'Boutique space in Koramangala',
    '80 Feet Road, Koramangala',
    'Koramangala',
    'Bengaluru',
    12.9352,
    77.6245,
    '["WiFi", "Phone booths", "Events"]'::jsonb,
    '["https://example.com/images/workhome-hero.jpg"]'::jsonb,
    'From ₹5,000/seat',
    'Coworking',
    'https://cofynd.com/coworking/workhome',
    '2026-07-23T12:00:00Z',
    '2026-07-23T12:00:00Z'
  )
ON CONFLICT (slug) DO NOTHING;
