"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Row = {
  topic: string;
  sessions: number;
  soloScore: number | null;
  retentionScore: number | null;
  indexAvg: number | null;
  status: "green" | "amber" | "red" | "none";
};

const STATUS: Record<
  Row["status"],
  { dot: string; label: string; blurb: string }
> = {
  green: {
    dot: "bg-emerald-500",
    label: "ready",
    blurb: "solo ≥ 70% and it stuck on a re-check",
  },
  amber: {
    dot: "bg-amber-500",
    label: "in progress",
    blurb: "decent solo check, retention not proven yet",
  },
  red: {
    dot: "bg-red-500",
    label: "not yet",
    blurb: "the solo check didn't go well — worth another session",
  },
  none: {
    dot: "bg-slate-300",
    label: "no solo check yet",
    blurb: "end a session with the solo check to get a signal",
  },
};

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

export default function ReadyPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ready")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setRows(d.rows as Row[]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">
          Ready without the AI?
        </h1>
        <Link
          href="/"
          className="rounded text-sm text-black/50 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
        >
          ← Back to chat
        </Link>
      </div>
      <p className="mt-1 text-sm text-black/50">
        Green = you did this without the AI and it stuck. Behavioural signals,
        not a verdict on you.
      </p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-black/10 bg-white/60">
        {error && <div className="p-4 text-sm text-red-600">{error}</div>}

        {!error && !rows && (
          <div className="p-8 text-center text-sm text-black/40">Loading…</div>
        )}

        {!error && rows && rows.length === 0 && (
          <div className="p-8 text-center text-sm text-black/40">
            No tagged sessions yet. Have a session and end it — the topics land
            here with your solo and retention results.
          </div>
        )}

        {!error && rows && rows.length > 0 && (
          <ul className="divide-y divide-black/5">
            {rows.map((r) => {
              const s = STATUS[r.status];
              return (
                <li
                  key={r.topic}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`h-3 w-3 shrink-0 rounded-full ${s.dot}`}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {r.topic}
                      </div>
                      <div className="text-xs text-black/40">
                        {s.label} · {s.blurb}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-4 pl-6 text-xs tabular-nums text-black/60 sm:pl-0">
                    <span title="latest solo checkpoint score">
                      solo <strong>{pct(r.soloScore)}</strong>
                    </span>
                    <span title="latest retention re-check score">
                      stuck <strong>{pct(r.retentionScore)}</strong>
                    </span>
                    <span title="average Independence Index across sessions">
                      index <strong>{r.indexAvg ?? "—"}</strong>
                    </span>
                    <span className="text-black/35">
                      {r.sessions} session{r.sessions === 1 ? "" : "s"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-black/40">
        {(Object.keys(STATUS) as Row["status"][]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${STATUS[k].dot}`} />
            {STATUS[k].label}
          </span>
        ))}
      </div>
    </main>
  );
}
