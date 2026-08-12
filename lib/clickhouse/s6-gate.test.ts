import { describe, it, expect, beforeAll } from "vitest";
import { getPool } from "../db/client";
import { replicateEnquiries } from "./replicate";
import { reconcileEnquiries, evaluateReport } from "./reconcile";
import { chExec } from "./client";

const live = Boolean(process.env.CLICKHOUSE_URL && process.env.TEST_DATABASE_URL);

describe.skipIf(!live)("S6 gate: replicated data matches source", () => {
  beforeAll(async () => {
    await chExec("TRUNCATE TABLE analytics.enquiry_fact");
    await getPool().query("DELETE FROM context.replication_state WHERE source_table = 'adsagent.enquiries'");
  });

  it("matches after a fresh insert is replicated, and stays matched across three runs", async () => {
    const org = (
      await getPool().query<{ id: string }>("SELECT id::text AS id FROM public.orgs ORDER BY id LIMIT 1")
    ).rows[0].id;

    await getPool().query(
      `INSERT INTO adsagent.enquiries (org_id, reply_state, first_seen_at, last_activity_at, updated_at)
       VALUES ($1, 'waiting', now() - interval '10 minutes', now() - interval '10 minutes', now() - interval '10 minutes')`,
      [org],
    );

    const replicated = await replicateEnquiries({ toleranceSeconds: 5 });
    expect(replicated.rowsCopied, "replicate must copy rows into ClickHouse").toBeGreaterThan(0);

    for (let run = 0; run < 3; run += 1) {
      const report = await reconcileEnquiries({ toleranceSeconds: 5 });
      const verdict = evaluateReport(report, 900);
      expect(verdict.alert, `run ${run + 1}`).toBeNull();
      expect(verdict.ok).toBe(true);
    }
  }, 60_000);

  it("every ClickHouse table carrying org_id leads its sort key with it", async () => {
    const { chQuery } = await import("./client");
    const rows = await chQuery<{ name: string }>(
      `SELECT concat(database, '.', name) AS name FROM system.tables
        WHERE database IN ('analytics', 'raw')
          AND engine LIKE '%MergeTree'
          AND position(sorting_key, 'org_id') != 1`,
    );
    expect(rows).toEqual([]);
  });

  it("every ClickHouse fact table has a row policy", async () => {
    const { chQuery } = await import("./client");
    const rows = await chQuery<{ name: string }>(
      `SELECT concat(t.database, '.', t.name) AS name FROM system.tables t
        LEFT JOIN system.row_policies p ON p.database = t.database AND p.table = t.name
        WHERE t.database IN ('analytics', 'raw') AND t.engine LIKE '%MergeTree' AND p.name IS NULL`,
    );
    expect(rows).toEqual([]);
  });
});
