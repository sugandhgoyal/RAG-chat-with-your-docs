// Usage: npm run ask -- "your question here"
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { askQuestion } from "../src/lib/rag";

async function main() {
  const question = process.argv.slice(2).join(" ");
  if (!question) {
    console.log('Usage: npm run ask -- "your question"');
    return;
  }
  const { answer, sources } = await askQuestion(question);

  console.log("\nANSWER:\n" + answer);
  console.log("\nSOURCES:");
  for (const s of sources) {
    console.log(`  [${s.id}] ${s.file}${s.page ? ` (page ${s.page})` : ""}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
