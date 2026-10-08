import { retrieveSources, buildMessages, getChatModel } from "@/lib/rag";
import { checkDemoLimits } from "@/lib/ratelimit";

// (Node.js is the default runtime, which Supabase + LangChain need)
export const maxDuration = 60; // seconds; on Vercel this is the function time limit

const MAX_QUESTION_LENGTH = 500;

// Streams newline-delimited JSON ("NDJSON"), one event per line:
//   {"type":"sources","sources":[...]}   <- sent first, so the UI can show citations early
//   {"type":"token","text":"..."}        <- repeated, a few words at a time
//   {"type":"done"}  or  {"type":"error","message":"..."}
export async function POST(req: Request) {
  let question: unknown;
  try {
    ({ question } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof question !== "string" || !question.trim()) {
    return Response.json({ error: "Question is required" }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return Response.json({ error: `Question too long (max ${MAX_QUESTION_LENGTH} characters)` }, { status: 400 });
  }
  const q = question.trim();

  // Checked after validation so malformed requests don't use up anyone's daily allowance
  const limit = await checkDemoLimits(req);
  if (!limit.ok) {
    return Response.json({ error: limit.message }, { status: limit.status });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        const sources = await retrieveSources(q);
        send({ type: "sources", sources });

        if (sources.length === 0) {
          send({ type: "token", text: "I couldn't find that in the documents." });
        } else {
          const answerStream = await getChatModel().stream(buildMessages(q, sources));
          for await (const chunk of answerStream) {
            if (chunk.text) send({ type: "token", text: chunk.text });
          }
        }
        send({ type: "done" });
      } catch (err) {
        console.error("chat route error:", err); // full detail stays in server logs
        send({ type: "error", message: "Something went wrong. Please try again." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
