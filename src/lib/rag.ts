import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { getVectorStore } from "./vectorstore";

export type Source = {
  id: number; // the [n] number the model uses to cite this chunk
  file: string;
  page: number | null;
  snippet: string;
};

const TOP_K = 4; // how many chunks we hand to the LLM

// The ONE place that decides which chat model answers.
// Later we swap this to Claude without touching anything else.
export function getChatModel() {
  return new ChatGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_API_KEY,
    model: "gemini-flash-latest",
    temperature: 0,
    // This model "thinks" silently before answering (took 25s+ per question).
    // Answering from supplied passages doesn't need deep reasoning.
    thinkingConfig: { thinkingLevel: "LOW" },
    maxRetries: 2, // fail fast instead of retrying for minutes on rate limits
  });
}

// RETRIEVE: embed the question, ask Supabase for the closest chunks
export async function retrieveSources(question: string): Promise<Source[]> {
  const store = getVectorStore("query");
  const docs = await store.similaritySearch(question, TOP_K);
  return docs.map((d, i) => ({
    id: i + 1,
    file: d.metadata?.source ?? "unknown",
    page: d.metadata?.page ?? null,
    snippet: d.pageContent,
  }));
}

// AUGMENT: put numbered chunks + the question into a prompt
export function buildMessages(question: string, sources: Source[]) {
  const context = sources
    .map((s) => `[${s.id}] (${s.file}${s.page ? `, page ${s.page}` : ""})\n${s.snippet}`)
    .join("\n\n---\n\n");

  const system = new SystemMessage(
    `You answer questions using ONLY the numbered context below.
- Cite the sources you used inline like [1] or [2][3].
- If the context does not contain the answer, say "I couldn't find that in the documents." Do not guess.
- Be concise.
- Write plain text only: no Markdown (no ** bold, no # headings). For lists, start lines with "- ".

CONTEXT:
${context}`,
  );
  return [system, new HumanMessage(question)];
}

// Full non-streaming flow (used by the CLI test; the API route will stream instead)
export async function askQuestion(question: string) {
  const sources = await retrieveSources(question);
  if (sources.length === 0) {
    return { answer: "I couldn't find that in the documents.", sources };
  }
  const response = await getChatModel().invoke(buildMessages(question, sources));
  return { answer: response.text, sources };
}
