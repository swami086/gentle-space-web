import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { retrieveListings } from "../lib/search/retrieve";
import { parseStoredPrice } from "../lib/sync/sources/price";
import type { Listing } from "../lib/listings/types";

type Bounds = { sw: [number, number]; ne: [number, number] };

type ConstraintQuery = {
  id: string;
  query: string;
  area?: string;
  maxMonthlyInr?: number;
};

type SoftQuery = { id: string; query: string; relevantIds: string[] };

type GoldenSet = {
  areas: Record<string, Bounds>;
  constraintQueries: ConstraintQuery[];
  softQueries: SoftQuery[];
};

/**
 * Location verdict per returned listing.
 * - `inside`: coordinates fall in the locality's bounds rectangle.
 * - `named`: coordinates fall outside, but the listing's own address or area names the
 *   requested locality. Google's polygons are tight — a rooftop in "Sahakar Nagar, Hebbal"
 *   sits outside the "Hebbal" rectangle while being unarguably in Hebbal. Counting this as
 *   a match keeps the metric honest in the strict direction: it can only be claimed when
 *   the listing's own address asserts the locality.
 * - `unknown`: no coordinates. Never a violation.
 * - `outside`: neither bounds nor name. The real failure.
 */
type LocationVerdict = "inside" | "named" | "outside" | "unknown";
/** Budget verdict per returned listing. `unknown` = unparseable price, never a violation. */
type BudgetVerdict = "within" | "over" | "unknown";

type QueryReport = {
  id: string;
  query: string;
  returned: number;
  location?: Record<LocationVerdict, number>;
  /** Titles of listings whose coordinates fall outside the requested bounds. */
  locationViolators?: string[];
  budget?: Record<BudgetVerdict, number>;
};

type Report = {
  label: string;
  ranAt: string;
  limit: number;
  queries: QueryReport[];
  summary: {
    locationConstrained: number;
    locationChecked: number;
    locationViolations: number;
    locationViolationRate: number;
    locationNamed: number;
    locationUnknown: number;
    budgetConstrained: number;
    budgetChecked: number;
    budgetOver: number;
    budgetOverRate: number;
    budgetUnknown: number;
    ndcgAt10: number | null;
  };
};

function namesArea(listing: Listing, area: string): boolean {
  const needle = area.toLowerCase().replace(/\s+/g, " ");
  const haystack = `${listing.area} ${listing.address}`.toLowerCase().replace(/\s+/g, " ");
  return haystack.includes(needle);
}

function locationVerdict(listing: Listing, bounds: Bounds, area: string): LocationVerdict {
  if (listing.lat === null || listing.lng === null) return "unknown";
  const [minLat, minLng] = bounds.sw;
  const [maxLat, maxLng] = bounds.ne;
  const inside =
    listing.lat >= minLat && listing.lat <= maxLat && listing.lng >= minLng && listing.lng <= maxLng;
  if (inside) return "inside";
  return namesArea(listing, area) ? "named" : "outside";
}

function budgetVerdict(listing: Listing, maxMonthlyInr: number): BudgetVerdict {
  const price = parseStoredPrice(listing.pricingHint);
  if (!price || price.monthlyInr === null) return "unknown";
  return price.monthlyInr <= maxMonthlyInr ? "within" : "over";
}

/** nDCG@10 with binary relevance, over whatever soft queries carry labels. */
function ndcg(listings: Listing[], relevantIds: string[]): number | null {
  if (relevantIds.length === 0) return null;
  const relevant = new Set(relevantIds);
  const dcg = listings
    .slice(0, 10)
    .reduce((sum, l, i) => sum + (relevant.has(l.id) ? 1 / Math.log2(i + 2) : 0), 0);
  const ideal = Array.from({ length: Math.min(relevantIds.length, 10) }).reduce<number>(
    (sum, _, i) => sum + 1 / Math.log2(i + 2),
    0,
  );
  return ideal === 0 ? null : dcg / ideal;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Vertex embedding quota is per-minute and the harness fires one query after another,
 * so a bare loop reliably trips 429 partway through and throws the whole run away.
 */
async function retrieveWithRetry(query: string, limit: number, attempts = 5) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await retrieveListings(query, limit);
    } catch (err) {
      const rateLimited = String(err).includes("429");
      if (!rateLimited || attempt >= attempts) throw err;
      const backoff = 2 ** attempt * 1000;
      console.log(`  rate limited, retrying in ${backoff / 1000}s`);
      await sleep(backoff);
    }
  }
}

function tally<T extends string>(verdicts: T[], keys: T[]): Record<T, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;
  for (const v of verdicts) out[v] += 1;
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const label = args.find((a) => a.startsWith("--label="))?.split("=")[1] ?? "baseline";
  const outPath = args.find((a) => a.startsWith("--out="))?.split("=")[1];
  const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 10) || 10;
  const delayMs = Number(args.find((a) => a.startsWith("--delay="))?.split("=")[1] ?? 2000) || 0;

  const golden = JSON.parse(
    readFileSync(resolve(process.cwd(), "docs/eval/golden-queries.json"), "utf8"),
  ) as GoldenSet;

  const queries: QueryReport[] = [];
  const summary: Report["summary"] = {
    locationConstrained: 0,
    locationChecked: 0,
    locationViolations: 0,
    locationViolationRate: 0,
    locationNamed: 0,
    locationUnknown: 0,
    budgetConstrained: 0,
    budgetChecked: 0,
    budgetOver: 0,
    budgetOverRate: 0,
    budgetUnknown: 0,
    ndcgAt10: null,
  };

  for (const [index, q] of golden.constraintQueries.entries()) {
    if (index > 0) await sleep(delayMs);
    const { listings } = await retrieveWithRetry(q.query, limit);
    const report: QueryReport = { id: q.id, query: q.query, returned: listings.length };

    if (q.area) {
      const bounds = golden.areas[q.area];
      if (!bounds) throw new Error(`golden set has no bounds for area "${q.area}"`);
      const verdicts = listings.map((l) => locationVerdict(l, bounds, q.area!));
      report.location = tally(verdicts, ["inside", "named", "outside", "unknown"]);
      report.locationViolators = listings
        .filter((_, i) => verdicts[i] === "outside")
        .map((l) => `${l.title} [${l.area || "no area"}]`);
      summary.locationConstrained += 1;
      summary.locationChecked +=
        report.location.inside + report.location.named + report.location.outside;
      summary.locationViolations += report.location.outside;
      summary.locationNamed += report.location.named;
      summary.locationUnknown += report.location.unknown;
    }

    if (q.maxMonthlyInr !== undefined) {
      const verdicts = listings.map((l) => budgetVerdict(l, q.maxMonthlyInr!));
      report.budget = tally(verdicts, ["within", "over", "unknown"]);
      summary.budgetConstrained += 1;
      summary.budgetChecked += report.budget.within + report.budget.over;
      summary.budgetOver += report.budget.over;
      summary.budgetUnknown += report.budget.unknown;
    }

    queries.push(report);
    console.log(
      [
        q.id.padEnd(20),
        `n=${String(report.returned).padStart(2)}`,
        report.location
          ? `loc in/named/out=${report.location.inside}/${report.location.named}/${report.location.outside}`
          : "loc -".padEnd(24),
        report.budget
          ? `budget ok/over/unk=${report.budget.within}/${report.budget.over}/${report.budget.unknown}`
          : "",
      ].join("  "),
    );
  }

  const ndcgScores: number[] = [];
  for (const q of golden.softQueries) {
    if (q.relevantIds.length === 0) continue;
    await sleep(delayMs);
    const { listings } = await retrieveWithRetry(q.query, Math.max(limit, 10));
    const score = ndcg(listings, q.relevantIds);
    if (score !== null) {
      ndcgScores.push(score);
      console.log(`${q.id.padEnd(20)}  nDCG@10=${score.toFixed(3)}`);
    }
  }

  summary.locationViolationRate = summary.locationChecked
    ? summary.locationViolations / summary.locationChecked
    : 0;
  summary.budgetOverRate = summary.budgetChecked ? summary.budgetOver / summary.budgetChecked : 0;
  summary.ndcgAt10 = ndcgScores.length
    ? ndcgScores.reduce((a, b) => a + b, 0) / ndcgScores.length
    : null;

  const unlabelled = golden.softQueries.filter((q) => q.relevantIds.length === 0).length;

  console.log(`\n=== ${label} ===`);
  console.log(
    `location violations   ${summary.locationViolations}/${summary.locationChecked} ` +
      `(${(summary.locationViolationRate * 100).toFixed(1)}%)  [target 0%]`,
  );
  console.log(
    `  matched by bounds   ${summary.locationChecked - summary.locationNamed - summary.locationViolations}`,
  );
  console.log(`  matched by address  ${summary.locationNamed} (outside tight Google polygon)`);
  console.log(
    `  no coordinates      ${summary.locationUnknown} (excluded from the rate, not violations)`,
  );
  console.log(
    `over budget           ${summary.budgetOver}/${summary.budgetChecked} ` +
      `(${(summary.budgetOverRate * 100).toFixed(1)}%)  [soft signal: track, do not gate]`,
  );
  console.log(`  price unparseable   ${summary.budgetUnknown}`);
  console.log(
    `nDCG@10               ${summary.ndcgAt10 === null ? `n/a (${unlabelled} soft queries unlabelled)` : summary.ndcgAt10.toFixed(3)}`,
  );

  if (outPath) {
    const report: Report = { label, ranAt: new Date().toISOString(), limit, queries, summary };
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nwrote ${outPath}`);
  }
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
