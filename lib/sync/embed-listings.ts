import { listListings, updateListingEmbedding } from "../db/listings";
import { buildListingEmbeddingText } from "../listings/embedding-text";
import { embedTexts } from "../ai/client";

const CHUNK = 32;

export async function embedAllListings(): Promise<number> {
  const listings = await listListings();
  let n = 0;
  for (let i = 0; i < listings.length; i += CHUNK) {
    const chunk = listings.slice(i, i + CHUNK);
    const texts = chunk.map(buildListingEmbeddingText);
    const vectors = await embedTexts(texts);
    for (let j = 0; j < chunk.length; j++) {
      await updateListingEmbedding(chunk[j].id, vectors[j]);
      n++;
    }
  }
  return n;
}
