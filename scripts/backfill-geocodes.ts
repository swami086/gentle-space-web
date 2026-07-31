/**
 * Backfill listings.lat/lng via Google Geocoding API when sources omit coords.
 * ApproxAreaMap / SpacesMap need these server-side; clients only see offset approx*.
 *
 * Usage: npm run geocode:backfill
 * Optional: GEOCODE_LIMIT=50 to cap batch size.
 */
import { geocodeListingsMissingCoords } from "../lib/sync/geocode-listings";

async function main(): Promise<void> {
  if (!process.env.GOOGLE_GEOCODING_API_KEY) {
    throw new Error("GOOGLE_GEOCODING_API_KEY is required");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const result = await geocodeListingsMissingCoords();
  console.log(
    `geocode done: updated=${result.updated} skipped=${result.skipped} failed=${result.failed} scanned=${result.scanned}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
