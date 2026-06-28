"use client";

import { useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";
type Message = {
  role: Role;
  content: string;
  mode?: string;
  confidence?: number;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the latest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error ?? "Something went wrong.");
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply || "(no reply)",
          mode: data.mode,
          confidence: data.confidence,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <main className="mx-auto flex h-screen max-w-2xl flex-col px-4">
      <header className="shrink-0 border-b border-black/10 py-5">
        <h1 className="text-lg font-semibold tracking-tight">Counterweight</h1>
        <p className="text-sm text-black/50">
          An effort-aware study partner — it helps you think, not outsource.
        </p>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto py-6"
        aria-live="polite"
      >
        {messages.length === 0 && !loading && (
          <div className="mt-16 text-center text-black/40">
            <p className="text-sm">
              Bring something you&apos;re working through. Start by saying what
              you&apos;ve tried.
            </p>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-ink px-4 py-2.5 text-sm text-paper">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex flex-col items-start">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-black/[0.04] px-4 py-2.5 text-sm text-ink">
                {m.content}
              </div>
              {m.mode && (
                <span className="mt-1 pl-1 font-mono text-[11px] uppercase tracking-wide text-black/35">
                  {m.mode}
                  {typeof m.confidence === "number"
                    ? ` · ${Math.round(m.confidence * 100)}%`
                    : ""}
                </span>
              )}
            </div>
          )
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-black/[0.04] px-4 py-2.5 text-sm text-black/40">
              thinking…
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-black/10 py-4">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="What are you working on?"
            className="max-h-40 flex-1 resize-none rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-sm outline-none placeholder:text-black/30 focus:border-black/40"
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-paper transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-black/30">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </main>
  );
}
