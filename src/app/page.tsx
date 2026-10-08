"use client";

import { useEffect, useRef, useState } from "react";
import type { Source } from "@/lib/rag";

type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  error?: boolean;
};

const SUGGESTIONS = [
  "What is retrieval-augmented generation?",
  "How does LoRA reduce the number of trainable parameters?",
  "What problem does 'Lost in the Middle' describe?",
];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Update the last (assistant) message in place as the stream arrives
  const patchLast = (fn: (m: Message) => Message) =>
    setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: q },
      { role: "assistant", content: "" },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? "Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Events are one JSON object per line; a network chunk may end mid-line
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "sources") patchLast((m) => ({ ...m, sources: event.sources }));
          else if (event.type === "token") patchLast((m) => ({ ...m, content: m.content + event.text }));
          else if (event.type === "error") patchLast((m) => ({ ...m, content: event.message, error: true }));
        }
      }
    } catch (err) {
      patchLast((m) => ({
        ...m,
        content: err instanceof Error ? err.message : "Something went wrong.",
        error: true,
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-3xl flex-col px-4">
      <header className="py-5">
        <h1 className="text-xl font-semibold">Docs Chat</h1>
        <p className="text-sm text-neutral-500">Ask questions about your documents. Answers cite their sources.</p>
      </header>

      <section aria-live="polite" className="flex-1 space-y-6 overflow-y-auto pb-4">
        {messages.length === 0 && (
          <div className="mt-10 space-y-3 text-center">
            <p className="text-neutral-500">Try asking:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="rounded-full border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <MessageView key={i} message={m} pending={busy && i === messages.length - 1} />
        ))}
        <div ref={bottomRef} />
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex gap-2 pb-5 pt-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about your documents..."
          aria-label="Your question"
          maxLength={500}
          className="flex-1 rounded-lg border border-neutral-300 bg-transparent px-4 py-3 outline-none focus:border-blue-500 dark:border-neutral-700"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-lg bg-blue-600 px-5 py-3 font-medium text-white disabled:opacity-40"
        >
          {busy ? "..." : "Ask"}
        </button>
      </form>
    </main>
  );
}

function MessageView({ message, pending }: { message: Message; pending: boolean }) {
  const [openId, setOpenId] = useState<number | null>(null);

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl bg-blue-600 px-4 py-2 text-white">{message.content}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className={`whitespace-pre-wrap leading-relaxed ${message.error ? "text-red-500" : ""}`}>
        {message.content
          ? renderWithCitations(message.content, (id) => setOpenId(openId === id ? null : id))
          : pending && <span className="text-neutral-500">Searching documents...</span>}
      </p>

      {message.sources && message.sources.length > 0 && (
        <div className="space-y-1 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
          <p className="font-medium text-neutral-500">Sources</p>
          {message.sources.map((s) => (
            <div key={s.id}>
              <button
                onClick={() => setOpenId(openId === s.id ? null : s.id)}
                aria-expanded={openId === s.id}
                className="text-left hover:underline"
              >
                <span className="mr-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs dark:bg-neutral-700">{s.id}</span>
                {s.file}
                {s.page ? `, page ${s.page}` : ""}
              </button>
              {openId === s.id && (
                <p className="mt-1 whitespace-pre-wrap rounded bg-neutral-100 p-2 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
                  {s.snippet}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Turn "[1]" in the answer into small clickable chips that open that source
function renderWithCitations(text: string, onPick: (id: number) => void) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (!match) return part;
    const id = Number(match[1]);
    return (
      <button
        key={i}
        onClick={() => onPick(id)}
        className="mx-0.5 rounded bg-blue-100 px-1.5 text-xs font-medium text-blue-700 hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-300"
      >
        {id}
      </button>
    );
  });
}
