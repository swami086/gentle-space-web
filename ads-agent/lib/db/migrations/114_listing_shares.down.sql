-- Refusing to drop while platform ids remain: Meta/Google campaigns and ad sets
-- would keep their budgets outside this schema.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM adsagent.listing_shares
     WHERE external_campaign_id IS NOT NULL
        OR external_ad_set_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'listing_shares still reference platform campaigns or ad sets';
  END IF;
END $$;

DROP POLICY IF EXISTS tenant_isolation ON adsagent.listing_build_steps;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.listing_shares;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.listing_ceilings;
DROP POLICY IF EXISTS tenant_isolation ON adsagent.listings;

DROP TABLE IF EXISTS adsagent.listing_build_steps;
DROP TABLE IF EXISTS adsagent.listing_shares;
DROP TABLE IF EXISTS adsagent.listing_ceilings;
DROP TABLE IF EXISTS adsagent.listings;
