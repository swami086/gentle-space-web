CREATE EXTENSION IF NOT EXISTS age;
LOAD 'age';
ALTER DATABASE gentle_space_listings SET search_path TO ag_catalog, "$user", public;
SET search_path TO ag_catalog, "$user", public;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = 'gentle_space') THEN
    PERFORM ag_catalog.create_graph('gentle_space');
  END IF;
END
$$;
