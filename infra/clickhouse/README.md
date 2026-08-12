# ClickHouse operations

## Local dev

```bash
docker compose -f docker-compose.clickhouse.yml up -d
curl -sf http://127.0.0.1:8123/ping   # expect: Ok.
docker exec gentle-space-clickhouse ls /etc/clickhouse-server/config.d/listen.xml
```

If host `curl` gets **connection reset** but `docker exec … wget http://127.0.0.1:8123/ping`
works, the bind mount is stale or empty — `listen.xml` never loaded, so HTTP only listens on
container localhost while Docker forwards to eth0. Recreate:

```bash
docker compose -f docker-compose.clickhouse.yml down
docker compose -f docker-compose.clickhouse.yml up -d
```

Apply migrations and run live tests:

```bash
export CLICKHOUSE_URL=http://127.0.0.1:8123 CLICKHOUSE_USER=etl_writer CLICKHOUSE_PASSWORD=etl
npx tsx scripts/clickhouse/migrate.ts
npx vitest run lib/clickhouse/graph-schema.test.ts
```

Two cron entries. Cron is a clock; it finds work and runs the job, and the job
publishes or alerts (datastore §14.5).

    */2 * * * * cd /opt/gentle-space-web && npx tsx --env-file=.env.local scripts/clickhouse/replicate.ts
    */5 * * * * cd /opt/gentle-space-web && npx tsx --env-file=.env.local scripts/clickhouse/reconcile.ts

Signals and their one alert each (datastore §12.4):

| Signal | Alert when | Source |
|---|---|---|
| CDC lag | `lag_seconds > CDC_LAG_ALERT_SECONDS` (default 900) | `context.reconciliation_runs` |
| Mirror divergence | any row with `ok = false` | `context.reconciliation_runs` |
| Ingest rejections | rejection rate above the accepted rate for an org | `context.ingest_rejection_counters` |
| Cross-tenant reads | any `context.access_log` row with `actor_kind = 'cross_tenant'` and `actor_ref` not in (`cdc-replicator`, `outbox-relay`) | `context.access_log` |

Retention runs daily; expiry is a partition drop, not a scan-and-delete.

    15 3 * * * cd /opt/gentle-space-web && npx tsx --env-file=.env.local scripts/clickhouse/retention.ts

Windows live in `context.purpose_retention` and are configuration, not code. A purpose
with no configured window is never dropped.
