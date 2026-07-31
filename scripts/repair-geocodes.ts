/**
 * Repair listings whose `area` and coordinates were derived from a junk address fragment.
 *
 * `coworker` used to set `area = address.split(",")[0]`, i.e. a floor or door number, and
 * geocoding then resolved that fragment confidently and wrongly. This script re-derives
 * `area` from the address locality and re-geocodes from the full address (rooftop
 * precision) instead of an area centroid.
 *
 * Dry run by default — prints what would change and calls no API. Pass --apply to write.
 *
 * Usage:
 *   npm run geocode:repair              # dry run, no API calls, no writes
 *   npm run geocode:repair -- --sample=15   # dry run + verify 15 rows against the live API
 *   npm run geocode:repair -- --apply   # re-geocode and write
 */
import { getPool } from "../lib/db/client";
import { localityFromAddress } from "../lib/listings/address";
import { sanitizeArea } from "../lib/listings/redact";
import { geocodeCandidates, geocodeFirstMatch, inBangalore } from "../lib/sync/geocode-listings";

type Row = {
  id: string;
  title: string;
  area: string;
  address: string;
  city: string;
  lat: number | null;
  lng: number | null;
};

const CITY_CENTROID = { lat: 12.9629, lng: 77.5775 };

function atCityCentroid(lat: number | null, lng: number | null): boolean {
  if (lat === null || lng === null) return false;
  return Math.abs(lat - CITY_CENTROID.lat) < 0.0005 && Math.abs(lng - CITY_CENTROID.lng) < 0.0005;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const sample = Number(args.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? 0) || 0;
  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if ((apply || sample > 0) && !apiKey) {
    throw new Error("GOOGLE_GEOCODING_API_KEY is required to geocode");
  }

  const pool = getPool();
  const { rows } = await pool.query<Row>(
    `SELECT id, title, area, address, city, lat, lng FROM listings ORDER BY id`,
  );

  const areaRepairs: { row: Row; from: string; to: string }[] = [];
  const regeocode: { row: Row; candidates: string[] }[] = [];
  let areaAlreadyClean = 0;
  let noAddress = 0;

  for (const row of rows) {
    const derived = localityFromAddress(row.address);
    const current = sanitizeArea(row.area);
    if (derived && derived !== current) {
      areaRepairs.push({ row, from: row.area || "<empty>", to: derived });
    } else if (current) {
      areaAlreadyClean += 1;
    }

    if (!row.address.trim()) {
      noAddress += 1;
    }
    // Re-derive for anything whose query would now differ: a repaired area, or a postal
    // address that used to lose to the area centroid, or coordinates parked at the city
    // centroid by a landmark phrase we now reject.
    const candidates = geocodeCandidates({ ...row, area: derived || row.area });
    const needsRepair =
      Boolean(row.address.trim()) || derived !== current || atCityCentroid(row.lat, row.lng);
    if (candidates.length > 0 && needsRepair) regeocode.push({ row, candidates });
  }

  console.log(`scanned                ${rows.length}`);
  console.log(`area repairs proposed  ${areaRepairs.length}`);
  console.log(`  area already correct ${areaAlreadyClean}`);
  console.log(`re-geocode candidates  ${regeocode.length}`);
  console.log(`  no address, skipped  ${noAddress}`);
  console.log(`currently at centroid  ${rows.filter((r) => atCityCentroid(r.lat, r.lng)).length}`);

  console.log(`\nsample area repairs:`);
  for (const r of areaRepairs.slice(0, 12)) {
    console.log(`  ${r.from.slice(0, 46).padEnd(46)} -> ${r.to}`);
  }

  if (!apply) {
    if (sample > 0) {
      console.log(`\nverifying ${sample} rows against the live Geocoding API (no writes):`);
      let moved = 0;
      for (const { row, candidates } of regeocode.slice(0, sample)) {
        try {
          const coords = await geocodeFirstMatch(candidates, apiKey!, fetch, 150);
          if (!coords) {
            console.log(`  ${row.title.slice(0, 28).padEnd(28)} no result`);
            continue;
          }
          const drift =
            row.lat !== null && row.lng !== null
              ? Math.round(
                  Math.hypot(coords.lat - row.lat, coords.lng - row.lng) * 111_000,
                )
              : null;
          if (drift !== null && drift > 300) moved += 1;
          console.log(
            `  ${row.title.slice(0, 28).padEnd(28)} ${drift === null ? "was null" : `${drift} m from stored`}`,
          );
        } catch (err) {
          console.log(`  ${row.title.slice(0, 28).padEnd(28)} error: ${String(err).slice(0, 60)}`);
        }
        await sleep(150);
      }
      console.log(`  moved more than 300 m: ${moved}/${sample}`);
    }
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to commit.`);
    return;
  }

  // `area` is part of the structured embedding text, so a repaired area whose embedding
  // still encodes "2nd & 3rd Floor" would keep failing locality searches. Clearing the
  // vector and its hash lets embed:backfill regenerate it.
  let areaWritten = 0;
  for (const { row, to } of areaRepairs) {
    await pool.query(
      `UPDATE listings
          SET area = $1, structured_embedding = NULL, embed_hash = NULL
        WHERE id = $2`,
      [to, row.id],
    );
    areaWritten += 1;
  }
  console.log(`\narea updated           ${areaWritten} (structured embeddings invalidated)`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const { row, candidates } of regeocode) {
    try {
      const coords = await geocodeFirstMatch(candidates, apiKey!, fetch, 150);
      if (!coords || !inBangalore(coords.lat, coords.lng)) {
        skipped += 1;
      } else {
        await pool.query(`UPDATE listings SET lat = $1, lng = $2 WHERE id = $3`, [
          coords.lat,
          coords.lng,
          row.id,
        ]);
        updated += 1;
      }
    } catch (err) {
      failed += 1;
      console.error(err instanceof Error ? err.message : err);
      if (String(err).includes("quota")) {
        console.error("stopping early on quota");
        break;
      }
    }
    await sleep(150);
  }
  console.log(`coords updated         ${updated}`);
  console.log(`coords skipped         ${skipped}`);
  console.log(`coords failed          ${failed}`);
  if (areaWritten > 0) {
    console.log(`\nNext: npm run embed:backfill  (${areaWritten} rows need re-embedding)`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
