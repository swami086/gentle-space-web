import { getPool } from "../db/client";
import { InsufficientCreditsError } from "./types";

export async function getOrgBalance(orgId: string): Promise<number> {
  const { rows } = await getPool().query<{ balance_credits: string }>(
    `SELECT balance_credits FROM org_balances WHERE org_id = $1`,
    [orgId],
  );
  return rows[0] ? Number(rows[0].balance_credits) : 0;
}

export async function getUserCap(userId: string): Promise<number | null> {
  const { rows } = await getPool().query<{ balance_credits: string }>(
    `SELECT balance_credits FROM user_balances WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ? Number(rows[0].balance_credits) : null;
}

export async function grantCredits(input: {
  orgId: string;
  userId?: string;
  amountCredits: number;
  grantedBy: string;
  note?: string;
}): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO credit_grants (org_id, user_id, amount_credits, granted_by, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.orgId, input.userId ?? null, input.amountCredits, input.grantedBy, input.note ?? null],
    );
    if (input.userId) {
      await client.query(
        `INSERT INTO user_balances (user_id, org_id, balance_credits)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id)
         DO UPDATE SET balance_credits = user_balances.balance_credits + $3, updated_at = NOW()`,
        [input.userId, input.orgId, input.amountCredits],
      );
    } else {
      await client.query(
        `UPDATE org_balances SET balance_credits = balance_credits + $2, updated_at = NOW()
         WHERE org_id = $1`,
        [input.orgId, input.amountCredits],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function debitUsage(input: {
  orgId: string;
  userId: string;
  feature: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  creditsDebited: number;
  requestId: string | null;
}): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const org = await client.query<{ balance_credits: string }>(
      `SELECT balance_credits FROM org_balances WHERE org_id = $1 FOR UPDATE`,
      [input.orgId],
    );
    if (!org.rows[0]) throw new InsufficientCreditsError(`Org ${input.orgId} has no credit pool`);

    const user = await client.query<{ balance_credits: string }>(
      `SELECT balance_credits FROM user_balances WHERE user_id = $1 FOR UPDATE`,
      [input.userId],
    );
    const hasUserCap = user.rows.length > 0;

    try {
      await client.query(
        `UPDATE org_balances SET balance_credits = balance_credits - $2, updated_at = NOW()
         WHERE org_id = $1`,
        [input.orgId, input.creditsDebited],
      );
      if (hasUserCap) {
        await client.query(
          `UPDATE user_balances SET balance_credits = balance_credits - $2, updated_at = NOW()
           WHERE user_id = $1`,
          [input.userId, input.creditsDebited],
        );
      }
    } catch {
      // The CHECK (balance_credits >= 0) constraint is the final backstop against a race; a
      // violation here means this specific debit would have gone negative.
      throw new InsufficientCreditsError("Debit would exceed available credits");
    }

    await client.query(
      `INSERT INTO usage_ledger
         (org_id, user_id, feature, provider, model, prompt_tokens, completion_tokens,
          total_tokens, cost_usd, credits_debited, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        input.orgId,
        input.userId,
        input.feature,
        input.provider,
        input.model,
        input.promptTokens,
        input.completionTokens,
        input.totalTokens,
        input.costUsd,
        input.creditsDebited,
        input.requestId,
      ],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
