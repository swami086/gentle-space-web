-- Emits one row per table as "schema.table<TAB>count", ordered, so the source
-- and the restored copy can be diffed byte-for-byte.
SELECT format('%s.%s', n.nspname, c.relname) AS table_name,
       (SELECT count(*) FROM pg_catalog.pg_class x WHERE x.oid = c.oid) * 0
         + (xpath('/row/c/text()',
             query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),
                          false, true, '')))[1]::text::bigint AS row_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r'
   AND n.nspname NOT IN ('pg_catalog','information_schema','ag_catalog')
 ORDER BY 1;
