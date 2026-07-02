"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Meters from "@/components/Meters";

type Role = "user" | "assistant";
type Message = {
  role: Role;
  content: string;
  mode?: string;
  confidence?: number | null;
};

type CheckpointView = {
  checkpointId: string;
  items: { id: string; question: string }[];
};
type CheckpointResultView = {
  score: number;
  items: {
    id: string;
    question: string;
    userAnswer: string;
    verdict: string | null;
    feedback: string | null;
  }[];
};

function verdictCls(v: string | null) {
  if (v === "correct") return "bg-emerald-100 text-emerald-700";
  if (v === "partial") return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [reflection, setReflection] = useState<string | null>(null);
  const [reflecting, setReflecting] = useState(false);
  const [checkpoint, setCheckpoint] = useState<CheckpointView | null>(null);
  const [cpAnswers, setCpAnswers] = useState<Record<string, string>>({});
  const [cpResult, setCpResult] = useState<CheckpointResultView | null>(null);
  const [cpSubmitting, setCpSubmitting] = useState(false);
  const [cpError, setCpError] = useState<string | null>(null);
  const [research, setResearch] = useState<{
    condition: string;
    participantId: string | null;
  } | null>(null);
  const [showMetersMobile, setShowMetersMobile] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);

  // Pick up a pre-created research session from the URL (?sid=&condition=&pid=).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("sid");
    if (sid) {
      sessionIdRef.current = sid;
      setSessionId(sid);
      const condition = params.get("condition");
      if (condition) {
        setResearch({ condition, participantId: params.get("pid") });
      }
    }
  }, []);

  // Keep the latest message in view (respecting reduced-motion).
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
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
      if (!res.ok) throw new Error(data?.error ?? "Something went wrong.");

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
      // Reflection (persona model) and checkpoint generation (cheap model) are
      // independent — run them in parallel.
      const [reflectRes, cpRes] = await Promise.all([
        fetch(`/api/session/${id}/reflect`, { method: "POST" }),
        fetch(`/api/session/${id}/checkpoint`, { method: "POST" }),
      ]);
      const reflectData = await reflectRes.json();
      if (!reflectRes.ok)
        throw new Error(reflectData?.error ?? "Failed to reflect.");
      setReflection(reflectData.reflection || "(no reflection)");

      // The solo check is optional — a too-thin session (422) just skips the offer.
      if (cpRes.ok) {
        const cpData = await cpRes.json();
        setCheckpoint({ checkpointId: cpData.checkpointId, items: cpData.items });
        setCpAnswers({});
        setCpResult(null);
        setCpError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reflect.");
    } finally {
      setReflecting(false);
    }
  }

  async function submitCheckpoint() {
    if (!checkpoint || cpSubmitting) return;
    setCpSubmitting(true);
    setCpError(null);
    try {
      const res = await fetch(
        `/api/checkpoint/${checkpoint.checkpointId}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answers: checkpoint.items.map((it) => ({
              itemId: it.id,
              answer: cpAnswers[it.id] ?? "",
            })),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to grade.");
      setCpResult(data);
      setRefreshKey((k) => k + 1); // meters pick up the Solo Score
    } catch (err) {
      setCpError(err instanceof Error ? err.message : "Failed to grade.");
    } finally {
      setCpSubmitting(false);
    }
  }

  function closeModal() {
    setReflection(null);
    setCheckpoint(null);
    setCpResult(null);
    setCpError(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const linkCls =
    "rounded text-black/50 underline-offset-4 transition hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40";

  // While the reflection/checkpoint modal is open, the chat is locked — the
  // solo check is answered without AI help.
  const modalOpen = reflection !== null;

  return (
    <main className="mx-auto flex h-[100dvh] max-w-5xl flex-col gap-4 px-4 md:flex-row md:gap-6">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-col gap-2 border-b border-black/10 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Counterweight</h1>
            <p className="text-sm text-black/50">
              An effort-aware study partner — it helps you think, not outsource.
            </p>
            {research && (
              <span className="mt-1 inline-block rounded-full bg-black/[0.05] px-2 py-0.5 font-mono text-[11px] text-black/50">
                research · {research.condition}
                {research.participantId ? ` · ${research.participantId}` : ""}
              </span>
            )}
          </div>
          <nav className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <Link href="/start" className={linkCls}>
              Research
            </Link>
            <Link href="/trends" className={linkCls}>
              Trends
            </Link>
            <Link href="/admin" className={linkCls}>
              Admin
            </Link>
            <button
              onClick={endSession}
              disabled={!sessionId || reflecting}
              className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {reflecting ? "Reflecting…" : "End session"}
            </button>
          </nav>
        </header>

        {/* Meters on mobile — collapsible so they don't dominate the screen. */}
        <div className="shrink-0 border-b border-black/10 py-2 md:hidden">
          <button
            onClick={() => setShowMetersMobile((s) => !s)}
            aria-expanded={showMetersMobile}
            className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-sm font-medium text-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
          >
            <span>Your meters</span>
            <span aria-hidden>{showMetersMobile ? "▲" : "▼"}</span>
          </button>
          {showMetersMobile && (
            <div className="pt-2">
              <Meters sessionId={sessionId} refreshKey={refreshKey} />
            </div>
          )}
        </div>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto py-6"
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
              disabled={modalOpen}
              placeholder={
                modalOpen
                  ? "AI is stepping away — this one is yours."
                  : "What are you working on?"
              }
              aria-label="Message"
              className="max-h-40 flex-1 resize-none rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-sm outline-none placeholder:text-black/30 focus-visible:border-black/40 focus-visible:ring-2 focus-visible:ring-ink/20 disabled:bg-black/[0.03]"
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim() || modalOpen}
              className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 disabled:cursor-not-allowed disabled:opacity-40"
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
          onClick={() => {
            // Don't lose in-progress solo-check answers on a stray backdrop click.
            if (!checkpoint || cpResult) closeModal();
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Session reflection"
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Session reflection</h2>
              <button
                onClick={closeModal}
                className="rounded text-black/40 transition hover:text-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {reflection}
            </div>

            {checkpoint && (
              <div className="mt-5 border-t border-black/10 pt-4">
                <h3 className="text-sm font-semibold">
                  Solo check — the AI is stepping away
                </h3>
                <p className="mt-0.5 text-xs text-black/50">
                  A few quick items on what you just worked on. This one is
                  yours: no help, no notes.
                </p>

                {!cpResult ? (
                  <div className="mt-3 space-y-4">
                    {checkpoint.items.map((it, i) => (
                      <div key={it.id}>
                        <label
                          htmlFor={`cp-${it.id}`}
                          className="block text-sm font-medium"
                        >
                          {i + 1}. {it.question}
                        </label>
                        <textarea
                          id={`cp-${it.id}`}
                          rows={2}
                          value={cpAnswers[it.id] ?? ""}
                          onChange={(e) =>
                            setCpAnswers((a) => ({
                              ...a,
                              [it.id]: e.target.value,
                            }))
                          }
                          placeholder="Your answer — a sentence or two"
                          className="mt-1.5 w-full resize-none rounded-xl border border-black/15 bg-white px-3 py-2 text-sm outline-none placeholder:text-black/30 focus-visible:border-black/40 focus-visible:ring-2 focus-visible:ring-ink/20"
                        />
                      </div>
                    ))}

                    {cpError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {cpError}
                      </div>
                    )}

                    <div className="flex items-center gap-3">
                      <button
                        onClick={submitCheckpoint}
                        disabled={cpSubmitting}
                        className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {cpSubmitting ? "Grading…" : "Submit answers"}
                      </button>
                      <button
                        onClick={closeModal}
                        className="rounded text-sm text-black/40 underline-offset-4 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
                      >
                        Not now
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 space-y-4">
                    <div className="rounded-xl bg-black/[0.03] p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-black/40">
                        Solo Score
                      </div>
                      <div className="mt-0.5 text-2xl font-semibold tabular-nums">
                        {Math.round(cpResult.score * 100)}%
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-black/40">
                        How you did on these items without help — not a measure
                        of you.
                      </p>
                    </div>

                    {cpResult.items.map((it, i) => (
                      <div key={it.id}>
                        <div className="text-sm font-medium">
                          {i + 1}. {it.question}
                        </div>
                        {it.userAnswer && (
                          <div className="mt-1 whitespace-pre-wrap text-sm text-black/60">
                            {it.userAnswer}
                          </div>
                        )}
                        <div className="mt-1.5 flex items-start gap-2">
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${verdictCls(it.verdict)}`}
                          >
                            {it.verdict ?? "ungraded"}
                          </span>
                          {it.feedback && (
                            <span className="text-xs leading-relaxed text-black/50">
                              {it.feedback}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}

                    <button
                      onClick={closeModal}
                      className="rounded-xl border border-black/15 px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
                    >
                      Done
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
