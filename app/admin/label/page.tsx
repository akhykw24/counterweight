"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Row = {
  turnId: string;
  sessionId: string;
  content: string;
  predictedMode: string;
  humanMode: string | null;
};

const MODES = ["STUCK", "OUTSOURCING", "ENGAGED", "DISTRESSED"];

export default function LabelPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/labels")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setRows(d.rows as Row[]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Live agreement as you label.
  const agreement = useMemo(() => {
    const list = rows ?? [];
    const labeled = list.filter((r) => r.humanMode);
    const agreed = labeled.filter((r) => r.humanMode === r.predictedMode).length;
    const pct = labeled.length ? Math.round((100 * agreed) / labeled.length) : 0;
    return { total: list.length, labeled: labeled.length, agreed, pct };
  }, [rows]);

  async function setLabel(turnId: string, humanMode: string) {
    const prev = rows;
    // optimistic update
    setRows((rs) =>
      (rs ?? []).map((r) =>
        r.turnId === turnId ? { ...r, humanMode: humanMode || null } : r
      )
    );
    setSaving(turnId);
    try {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId, humanMode }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Failed to save.");
      }
    } catch (e) {
      setRows(prev ?? null); // revert
      setError(e instanceof Error ? e.message : "Failed to save label.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">
          Admin · classifier validation
        </h1>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/admin" className="rounded text-black/50 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40">
            Export
          </Link>
          <Link href="/" className="rounded text-black/50 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40">
            ← Chat
          </Link>
        </div>
      </div>
      <p className="mt-1 text-sm text-black/50">
        Assign the true mode for each user turn. Agreement with the classifier is a
        quick sanity signal — export the labels to compute Cohen&apos;s κ offline.
      </p>

      {/* Agreement banner */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white/60 px-5 py-4">
        <div>
          <div className="text-3xl font-semibold tabular-nums">
            {agreement.labeled > 0 ? `${agreement.pct}%` : "—"}
          </div>
          <div className="text-xs text-black/50">
            agreement · {agreement.agreed}/{agreement.labeled} labeled
            {agreement.total > 0 ? ` of ${agreement.total} turns` : ""}
          </div>
        </div>
        <a
          href="/api/labels/export"
          className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
        >
          Download labels CSV
        </a>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-black/10 bg-white/60">
        {error && <div className="p-4 text-sm text-red-600">{error}</div>}

        {!error && !rows && (
          <div className="p-8 text-center text-sm text-black/40">Loading…</div>
        )}

        {!error && rows && rows.length === 0 && (
          <div className="p-8 text-center text-sm text-black/40">
            No classifier-labelled turns yet. Have an effort-aware chat, then come back.
          </div>
        )}

        {!error && rows && rows.length > 0 && (
          <ul className="divide-y divide-black/5">
            {rows.map((r) => {
              const match = r.humanMode && r.humanMode === r.predictedMode;
              const mismatch = r.humanMode && r.humanMode !== r.predictedMode;
              return (
                <li key={r.turnId} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:gap-4">
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-ink">
                    {r.content}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-black/40">
                      pred: {r.predictedMode}
                    </span>
                    <select
                      value={r.humanMode ?? ""}
                      onChange={(e) => setLabel(r.turnId, e.target.value)}
                      disabled={saving === r.turnId}
                      aria-label="True mode"
                      className={`rounded-lg border bg-white px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ink/30 ${
                        match
                          ? "border-emerald-300 text-emerald-700"
                          : mismatch
                            ? "border-amber-300 text-amber-700"
                            : "border-black/15 text-ink"
                      }`}
                    >
                      <option value="">— true mode —</option>
                      {MODES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
