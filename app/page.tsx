"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Meters from "@/components/Meters";

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

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [reflection, setReflection] = useState<string | null>(null);
  const [reflecting, setReflecting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);

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
        body: JSON.stringify({ messages: next, sessionId: sessionIdRef.current }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error ?? "Something went wrong.");
      }

      // Remember the session so later turns persist to the same row.
      if (data.sessionId) {
        sessionIdRef.current = data.sessionId;
        setSessionId(data.sessionId);
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

      // Nudge the meters to refetch (the judge scores this turn asynchronously).
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function endSession() {
    const id = sessionIdRef.current;
    if (!id || reflecting) return;
    setReflecting(true);
    setError(null);
    try {
      const res = await fetch(`/api/session/${id}/reflect`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to reflect.");
      setReflection(data.reflection || "(no reflection)");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reflect.");
    } finally {
      setReflecting(false);
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
    <main className="mx-auto flex h-screen max-w-5xl gap-6 px-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-black/10 py-5">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Counterweight</h1>
            <p className="text-sm text-black/50">
              An effort-aware study partner — it helps you think, not outsource.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="/trends"
              className="text-sm text-black/50 underline-offset-4 hover:underline"
            >
              Trends
            </Link>
            <button
              onClick={endSession}
              disabled={!sessionId || reflecting}
              className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {reflecting ? "Reflecting…" : "End session"}
            </button>
          </div>
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
      </div>

      <aside className="hidden w-72 shrink-0 self-center md:block">
        <Meters sessionId={sessionId} refreshKey={refreshKey} />
      </aside>

      {reflection && (
        <div
          className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setReflection(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Session reflection</h2>
              <button
                onClick={() => setReflection(null)}
                className="text-black/40 transition hover:text-black/70"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {reflection}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
