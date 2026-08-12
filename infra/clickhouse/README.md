# ClickHouse operations

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
