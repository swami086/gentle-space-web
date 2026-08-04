import { randomUUID } from "node:crypto";
import { getPool } from "../lib/db/client";
import { grantCredits, debitUsage } from "../lib/metering/ledger";

async function main() {
  const pool = getPool();
  const orgId = randomUUID();
  const userId = randomUUID();

  await pool.query(`INSERT INTO orgs (id, name) VALUES ($1, 'smoke-org')`, [orgId]);
  await pool.query(`INSERT INTO users (id, org_id, email) VALUES ($1, $2, 'smoke@example.com')`, [
    userId,
    orgId,
  ]);
  await pool.query(`INSERT INTO org_balances (org_id, balance_credits) VALUES ($1, 0)`, [orgId]);
  await grantCredits({ orgId, amountCredits: 10, grantedBy: "smoke" });

  // 5 concurrent 3-credit debits against a 10-credit balance: exactly 3 must succeed (9 credits),
  // the other 2 must fail, and the final balance must never go negative.
  const attempts = Array.from({ length: 5 }, (_, i) =>
    debitUsage({
      orgId,
      userId,
      feature: "smoke",
      provider: "vertex",
      model: "gemini-2.5-flash-lite",
      promptTokens: 10,
      completionTokens: 10,
      totalTokens: 20,
      costUsd: 0.001,
      creditsDebited: 3,
      requestId: `smoke-${i}`,
    })
      .then(() => true)
      .catch(() => false),
  );
  const results = await Promise.all(attempts);
  const succeeded = results.filter(Boolean).length;

  const { rows } = await pool.query<{ balance_credits: string }>(
    `SELECT balance_credits FROM org_balances WHERE org_id = $1`,
    [orgId],
  );
  const finalBalance = Number(rows[0].balance_credits);

  console.log(`succeeded: ${succeeded}/5, finalBalance: ${finalBalance}`);

  await pool.query(`DELETE FROM usage_ledger WHERE org_id = $1`, [orgId]);
  await pool.query(`DELETE FROM credit_grants WHERE org_id = $1`, [orgId]);
  await pool.query(`DELETE FROM org_balances WHERE org_id = $1`, [orgId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await pool.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);

  if (finalBalance < 0) {
    console.error("FAIL: balance went negative");
    process.exit(1);
  }
  if (succeeded !== 3) {
    console.error(`FAIL: expected exactly 3 successful debits, got ${succeeded}`);
    process.exit(1);
  }
  console.log("PASS: concurrent debits never went negative");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
