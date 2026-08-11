/**
 * Dev-only backfill for `performance_snapshots` — `npm run seed:performance`.
 *
 * The normal path (run-decision-cycle.ts) only ever inserts a snapshot for "now", so there's no way
 * to get a populated last-7-days trend without actually running the cron for a week. This script
 * backdates one snapshot per existing campaign per day for the last N days so the analytics tools
 * (get_spend_cpl_trend, list_campaigns_with_cpl) and the Hermes/OpenUI TrendChart have real data to
 * render during manual testing. Idempotent: deletes any snapshots it previously inserted for the
 * same campaigns before re-inserting, so re-running doesn't pile up duplicates.
 */
import { getPool } from "../lib/db/client";

const DAYS = 7;

async function main(): Promise<void> {
  const pool = getPool();
  const { rows: campaigns } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM campaigns ORDER BY created_at ASC`,
  );
  if (campaigns.length === 0) {
    console.log("seed:performance — no campaigns found, nothing to seed");
    process.exit(0);
  }

  await pool.query(`UPDATE campaigns SET status = 'active' WHERE status = 'proposed'`);

  const campaignIds = campaigns.map((c) => c.id);
  await pool.query(`DELETE FROM performance_snapshots WHERE campaign_id = ANY($1::uuid[])`, [campaignIds]);

  for (const campaign of campaigns) {
    for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo--) {
      const spend = 800 + Math.round(Math.random() * 700); // ₹800-1500/day
      const impressions = 2000 + Math.round(Math.random() * 3000);
      const clicks = 40 + Math.round(Math.random() * 50);
      const conversions = 1 + Math.round(Math.random() * 3);
      const cpl = spend / conversions;

      await pool.query(
        `INSERT INTO performance_snapshots (campaign_id, captured_at, spend, clicks, impressions, conversions, cpl)
         VALUES ($1, NOW() - ($2 || ' days')::interval, $3, $4, $5, $6, $7)`,
        [campaign.id, daysAgo, spend, clicks, impressions, conversions, cpl],
      );
    }
    console.log(`seed:performance — inserted ${DAYS} days for "${campaign.name}" (${campaign.id})`);
  }

  console.log("seed:performance — done");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
