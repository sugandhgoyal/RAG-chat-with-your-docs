// Usage: npm run download-samples
// Downloads a set of open-access arXiv papers into ./documents as demo data.
import fs from "node:fs";
import path from "node:path";

const PAPERS = [
  { id: "2005.11401", file: "rag-retrieval-augmented-generation.pdf" },
  { id: "1706.03762", file: "attention-is-all-you-need.pdf" },
  { id: "2307.03172", file: "lost-in-the-middle.pdf" },
  { id: "2004.04906", file: "dense-passage-retrieval.pdf" },
  { id: "1908.10084", file: "sentence-bert.pdf" },
  { id: "2106.09685", file: "lora.pdf" },
  { id: "2210.03629", file: "react.pdf" },
  { id: "2212.10496", file: "hyde.pdf" },
];

const DOCS_DIR = path.join(process.cwd(), "documents");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  for (const { id, file } of PAPERS) {
    const dest = path.join(DOCS_DIR, file);
    if (fs.existsSync(dest)) {
      console.log(`- ${file}: already exists, skipping`);
      continue;
    }
    const res = await fetch(`https://arxiv.org/pdf/${id}`, { redirect: "follow" });
    if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error(`${id}: response is not a PDF`);
    fs.writeFileSync(dest, bytes);
    console.log(`✓ ${file} (${(bytes.length / 1024).toFixed(0)} KB)`);
    await sleep(3000); // be polite to arXiv
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
