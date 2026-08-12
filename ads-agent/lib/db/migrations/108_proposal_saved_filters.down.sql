DROP POLICY IF EXISTS owner_isolation ON adsagent.proposal_saved_filters;
DROP TABLE IF EXISTS adsagent.proposal_saved_filters;
DROP FUNCTION IF EXISTS public.current_app_user();
DROP FUNCTION IF EXISTS public.set_user(UUID);
