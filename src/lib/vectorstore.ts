import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { TaskType } from "@google/generative-ai";

// Must match vector(768) in supabase/schema.sql
export const EMBEDDING_DIMENSIONS = 768;

// Read env vars lazily (inside functions) so scripts can load .env.local first.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Add it to .env.local`);
  return value;
}

export function getSupabaseClient() {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );
}

// Gemini lets us tell it what the text is FOR. Documents and questions get
// embedded slightly differently, which improves search quality.
export function getEmbeddings(kind: "document" | "query") {
  return new GoogleGenerativeAIEmbeddings({
    apiKey: requireEnv("GOOGLE_API_KEY"),
    model: "gemini-embedding-001",
    taskType:
      kind === "document"
        ? TaskType.RETRIEVAL_DOCUMENT
        : TaskType.RETRIEVAL_QUERY,
    outputDimensionality: EMBEDDING_DIMENSIONS,
  });
}

export function getVectorStore(kind: "document" | "query") {
  return new SupabaseVectorStore(getEmbeddings(kind), {
    client: getSupabaseClient(),
    tableName: "documents",
    queryName: "match_documents",
  });
}
