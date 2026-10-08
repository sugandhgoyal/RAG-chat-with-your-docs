// Usage: npm run ingest
// Reads every PDF in ./documents, chunks it, embeds each chunk, stores in Supabase.
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import {
  EMBEDDING_DIMENSIONS,
  getEmbeddings,
  getSupabaseClient,
  getVectorStore,
} from "../src/lib/vectorstore";

const DOCS_DIR = path.join(process.cwd(), "documents");
const BATCH_SIZE = 25; // chunks embedded per API call
const MS_PER_CHUNK = 1000; // pacing for Gemini free tier (set to 0 on a paid key)

const embeddings = getEmbeddings("document");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The free Gemini tier sometimes returns an empty/short vector under load instead of an
// error. Check every vector before it reaches the database; wait and retry if any is bad.
async function embedWithRetry(texts: string[], attempts = 5): Promise<number[][]> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const vectors = await embeddings.embedDocuments(texts);
      const ok =
        vectors.length === texts.length &&
        vectors.every((v) => v?.length === EMBEDDING_DIMENSIONS);
      if (ok) return vectors;
      console.warn(`  bad embedding batch (attempt ${attempt}/${attempts}), retrying...`);
    } catch (err) {
      console.warn(`  embedding error (attempt ${attempt}/${attempts}): ${(err as Error).message}`);
    }
    await sleep(30_000 * attempt); // let the per-minute quota window reset
  }
  throw new Error("Embedding failed after retries");
}

async function main() {
  const files = fs.readdirSync(DOCS_DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));
  if (files.length === 0) {
    console.log("No PDFs found in ./documents. Add some and rerun.");
    return;
  }
  console.log(`Found ${files.length} PDF(s)\n`);

  const supabase = getSupabaseClient();
  const vectorStore = getVectorStore("document");
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });

  for (const file of files) {
    // 1. LOAD: one Document per PDF page
    const pages = await new PDFLoader(path.join(DOCS_DIR, file)).load();

    // 2. SPLIT: pages -> ~1000 character chunks
    const rawChunks = await splitter.splitDocuments(pages);

    // Keep only the metadata we need (PDFLoader attaches a lot of extra info)
    const chunks = rawChunks.map(
      (c) =>
        new Document({
          pageContent: c.pageContent,
          metadata: { source: file, page: c.metadata?.loc?.pageNumber ?? null },
        }),
    );

    // Re-running ingest replaces a file's old chunks instead of duplicating them
    const { error } = await supabase.from("documents").delete().eq("metadata->>source", file);
    if (error) throw error;

    // 3. EMBED + STORE: in batches, so we don't send everything in one request
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const vectors = await embedWithRetry(batch.map((c) => c.pageContent));
      await vectorStore.addVectors(vectors, batch);
      // Stay under the free tier's per-minute limit: ~1 chunk per second
      await sleep(batch.length * MS_PER_CHUNK);
    }
    console.log(`✓ ${file}: ${pages.length} pages -> ${chunks.length} chunks`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
