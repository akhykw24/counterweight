"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Row = {
  participantId: string;
  condition: string;
  offloadRatio: number;
  verificationRate: number;
  caveRate: number;
  acceptanceLatency: number;
  independenceIndex: number;
  turnCount: number;
  probeCount: number;
  cavedCount: number;
  startedAt: string;
  endedAt: string;
};

export default function AdminPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/export?format=json")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setRows(d.rows as Row[]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Admin · export</h1>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href="/admin/label"
            className="rounded text-black/50 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
          >
            Labeling
          </Link>
          <Link
            href="/"
            className="rounded text-black/50 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
          >
            ← Back to chat
          </Link>
        </div>
      </div>
      <p className="mt-1 text-sm text-black/50">
        One row per session: participant, condition, the four metrics, Independence
        Index, turn/probe/cave counts, and timestamps.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <a
          href="/api/export?format=csv"
          className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
        >
          Download CSV
        </a>
        <a
          href="/api/export?format=json"
          className="rounded-xl border border-black/15 px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
        >
          Download JSON
        </a>
      </div>

      <div className="mt-8 overflow-x-auto rounded-2xl border border-black/10 bg-white/60">
        {error && <div className="p-4 text-sm text-red-600">{error}</div>}

        {!error && !rows && (
          <div className="p-8 text-center text-sm text-black/40">Loading…</div>
        )}

        {!error && rows && rows.length === 0 && (
          <div className="p-8 text-center text-sm text-black/40">
            No sessions yet. Run a chat (or a research session), then come back.
          </div>
        )}

        {!error && rows && rows.length > 0 && (
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-black/10 text-xs uppercase tracking-wide text-black/40">
                <th className="px-3 py-2.5 font-medium">Participant</th>
                <th className="px-3 py-2.5 font-medium">Condition</th>
                <th className="px-3 py-2.5 text-right font-medium">Index</th>
                <th className="px-3 py-2.5 text-right font-medium">Offload</th>
                <th className="px-3 py-2.5 text-right font-medium">Verify</th>
                <th className="px-3 py-2.5 text-right font-medium">Cave</th>
                <th className="px-3 py-2.5 text-right font-medium">Turns</th>
                <th className="px-3 py-2.5 text-right font-medium">Probes</th>
                <th className="px-3 py-2.5 text-right font-medium">Caved</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-black/5 last:border-0">
                  <td className="px-3 py-2.5">{r.participantId || "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-xs">{r.condition}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r.independenceIndex}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.offloadRatio}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r.verificationRate}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.caveRate}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.turnCount}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.probeCount}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.cavedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {rows && rows.length > 0 && (
        <p className="mt-3 text-xs text-black/30">
          {rows.length} session{rows.length === 1 ? "" : "s"} with at least one turn.
        </p>
      )}
    </main>
  );
}
