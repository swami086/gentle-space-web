import { listListings, listListingsMissingEmbedding, updateListingEmbeddings } from "../db/listings";
import { buildDescriptionEmbeddingText, buildStructuredEmbeddingText } from "../listings/embedding-text";
import { embedTexts } from "../ai/client";
import { forEachChunkPaced } from "./pace";

// Each listing now contributes 2 texts (structured + description) instead of 1,
// so halving listings-per-chunk keeps the same 32-texts-per-Vertex-call batch
// size as before the split.
const LISTINGS_PER_CHUNK = 16;
// Vertex AI's default quota for text-embedding-004 (billed under the legacy
// "textembedding-gecko" metric) is only 5 requests/min per region on a fresh
// GCP project. Pacing to ~30 listings/min keeps us well under that — even
// though halving LISTINGS_PER_CHUNK roughly doubles call frequency (~1.9
// calls/min vs. ~0.9 calls/min pre-split), both stay well under the 5/min
// ceiling.
const ITEMS_PER_MINUTE = 30;

export async function embedAllListings(): Promise<number> {
  const listings = await listListings();
  return embedListings(listings);
}

export async function embedListingsMissingEmbedding(): Promise<number> {
  const listings = await listListingsMissingEmbedding();
  return embedListings(listings);
}

function interleaveTexts(structured: string[], descriptions: string[]): string[] {
  const texts: string[] = [];
  for (let i = 0; i < structured.length; i++) {
    texts.push(structured[i], descriptions[i]);
  }
  return texts;
}

async function embedListings(listings: Awaited<ReturnType<typeof listListings>>): Promise<number> {
  let n = 0;
  await forEachChunkPaced(listings, LISTINGS_PER_CHUNK, ITEMS_PER_MINUTE, async (chunk) => {
    const structuredTexts = chunk.map(buildStructuredEmbeddingText);
    const descriptionTexts = chunk.map(buildDescriptionEmbeddingText);
    const vectors = await embedTexts(interleaveTexts(structuredTexts, descriptionTexts));

    for (let j = 0; j < chunk.length; j++) {
      await updateListingEmbeddings(chunk[j].id, {
        structured: vectors[2 * j],
        description: vectors[2 * j + 1],
      });
      n++;
    }
  });
  return n;
}
