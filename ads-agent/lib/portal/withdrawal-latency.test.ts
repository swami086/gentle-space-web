import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";

const live = Boolean(process.env.TEST_DATABASE_URL);

// Deliberately far longer than the budget: a pass inside the budget can only come
// from NOTIFY-driven invalidation, never from expiry.
const TTL_MS = 60_000;
const BUDGET_MS = 2_000;

let pool: Pool;
let orgId: string;
let ingestKey: string;

const SESSION = "withdrawlatency00001";
const scopeFor = (org: string) => ({ kind: "org", orgId: org }) as const;

beforeAll(async () => {
  if (!live) return;
  process.env.CONSENT_CACHE_TTL_MS = String(TTL_MS);
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 5 });
  orgId = (await pool.query<{ id: string }>("SELECT id::text AS id FROM public.orgs ORDER BY id LIMIT 1")).rows[0].id;
  ingestKey = `pk_test_${Date.now()}`;
  await pool.query(
    `INSERT INTO context.tenant_portal_config
       (org_id, ingest_key, allowed_origins, purposes_offered, notice_version)
     VALUES ($1, $2, ARRAY['https://broker.test'], ARRAY['space_recommendation'], 1)
     ON CONFLICT (org_id) DO UPDATE
       SET ingest_key = EXCLUDED.ingest_key,
           allowed_origins = EXCLUDED.allowed_origins,
           purposes_offered = EXCLUDED.purposes_offered`,
    [orgId, ingestKey],
  );
});

afterAll(async () => {
  if (!live) return;
  delete process.env.CONSENT_CACHE_TTL_MS;
  await pool.end();
});

beforeEach(async () => {
  if (!live) return;
  const { clearConsentCache } = await import("./consent-cache");
  clearConsentCache();
  const { clearPortalConfigCache } = await import("./config");
  clearPortalConfigCache();
  const { resetRateLimits } = await import("./rate-limit");
  resetRateLimits();
});

async function grant(): Promise<void> {
  const { recordConsent } = await import("./consent");
  await recordConsent(scopeFor(orgId), {
    subjectRef: SESSION,
    purposes: ["space_recommendation"],
    action: "granted",
    noticeVersion: 1,
    mechanism: "banner",
  });
}

/** Withdraws from a second pool, so the process under test learns about it only
 *  through the database — exactly as a broker's withdrawal route would. */
async function withdrawFromElsewhere(): Promise<number> {
  const other = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  try {
    await other.query("BEGIN");
    await other.query("SELECT public.set_tenant($1)", [orgId]);
    await other.query(
      `INSERT INTO context.consent_records
         (org_id, subject_ref, purposes, action, notice_version, mechanism)
       VALUES ($1, $2, ARRAY['space_recommendation'], 'withdrawn', 1, 'banner')`,
      [orgId, SESSION],
    );
    await other.query("COMMIT");
    return performance.now();
  } finally {
    await other.end();
  }
}

function ingestRequest(): Request {
  return new Request("https://ads.test/api/v1/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://broker.test", "X-Ingest-Key": ingestKey },
    body: JSON.stringify({
      taxonomy_version: 1,
      session_id: SESSION,
      events: [{ event: "listing_view", occurred_at: new Date().toISOString(), payload: { listing_ref: "l-1", dwell_seconds: 1 } }],
    }),
  });
}

describe.skipIf(!live)("withdrawal takes effect within seconds", () => {
  it("invalidates the consent cache within the budget, and the TTL cannot be the reason", async () => {
    const { getConsentStateCached, startConsentInvalidator, consentCacheTtlMs } = await import("./consent-cache");
    expect(consentCacheTtlMs()).toBe(TTL_MS);

    const stop = await startConsentInvalidator(pool);
    try {
      await grant();
      const primed = await getConsentStateCached(scopeFor(orgId), orgId, SESSION);
      expect(primed.purposes).toContain("space_recommendation");

      const withdrawnAt = await withdrawFromElsewhere();
      let observedAt: number | null = null;
      while (performance.now() - withdrawnAt < BUDGET_MS + 500) {
        const state = await getConsentStateCached(scopeFor(orgId), orgId, SESSION);
        if (!state.purposes.includes("space_recommendation")) {
          observedAt = performance.now();
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(observedAt, "withdrawal was never observed").not.toBeNull();
      const elapsed = observedAt! - withdrawnAt;
      console.log(`withdrawal observed after ${elapsed.toFixed(0)}ms (budget ${BUDGET_MS}ms, ttl ${TTL_MS}ms)`);
      expect(elapsed).toBeLessThan(BUDGET_MS);
    } finally {
      await stop();
    }
  }, 30_000);

  it("control: with no invalidator attached, the stale grant survives past the budget", async () => {
    const { getConsentStateCached, clearConsentCache } = await import("./consent-cache");
    clearConsentCache();
    await grant();
    await getConsentStateCached(scopeFor(orgId), orgId, SESSION);

    const withdrawnAt = await withdrawFromElsewhere();
    await new Promise((resolve) => setTimeout(resolve, BUDGET_MS));
    const state = await getConsentStateCached(scopeFor(orgId), orgId, SESSION);

    expect(performance.now() - withdrawnAt).toBeGreaterThanOrEqual(BUDGET_MS);
    expect(
      state.purposes,
      "control failed: the cache expired on its own, so the first test proves nothing about NOTIFY",
    ).toContain("space_recommendation");
  }, 30_000);

  it("the endpoint stops accepting the event within the budget", async () => {
    const { startConsentInvalidator } = await import("./consent-cache");
    const { POST } = await import("../../app/api/v1/ingest/route");

    const stop = await startConsentInvalidator(pool);
    try {
      await grant();
      const accepted = await POST(ingestRequest());
      expect(accepted.status).toBe(202);

      const withdrawnAt = await withdrawFromElsewhere();
      let rejectedAt: number | null = null;
      let lastStatus = 0;
      while (performance.now() - withdrawnAt < BUDGET_MS + 500) {
        const res = await POST(ingestRequest());
        lastStatus = res.status;
        if (res.status === 403) {
          expect(await res.json()).toEqual({ error: "no_consent" });
          rejectedAt = performance.now();
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(rejectedAt, `endpoint still returning ${lastStatus} after the budget`).not.toBeNull();
      const elapsed = rejectedAt! - withdrawnAt;
      console.log(`endpoint refused after ${elapsed.toFixed(0)}ms`);
      expect(elapsed).toBeLessThan(BUDGET_MS);
    } finally {
      await stop();
    }
  }, 30_000);
});
