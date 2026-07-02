"use client";

import { useEffect, useState } from "react";

type Metrics = {
  offloadRatio: number;
  verificationRate: number;
  caveRate: number;
  acceptanceLatency: number;
  independenceIndex: number;
  turnsScored: number;
  soloScore?: number | null;
};

type Tone = "good" | "warn" | "neutral";

function Bar({
  label,
  value,
  kind,
  tone,
  hint,
}: {
  label: string;
  value: number;
  kind: "ratio" | "latency";
  tone: Tone;
  hint: string;
}) {
  const pct =
    kind === "ratio"
      ? Math.round(value * 100)
      : Math.min(100, Math.round((value / 30) * 100)); // latency vs 30s target
  const display = kind === "ratio" ? `${Math.round(value * 100)}%` : `${value}s`;
  const fill =
    tone === "good"
      ? "bg-emerald-500/70"
      : tone === "warn"
        ? "bg-amber-500/70"
        : "bg-slate-400/70";

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-black/70">{label}</span>
        <span className="text-xs tabular-nums text-black/50">{display}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/10">
        <div
          className={`h-full rounded-full ${fill} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-0.5 text-[10px] text-black/30">{hint}</div>
    </div>
  );
}

/**
 * Live session meters. Reads the metrics endpoint and refreshes whenever
 * `refreshKey` changes (the chat bumps it after each reply). Because the
 * telemetry judge runs asynchronously, we re-poll a couple of times so the
 * meters catch the freshly scored turn.
 */
export default function Meters({
  sessionId,
  refreshKey,
}: {
  sessionId: string | null;
  refreshKey: number;
}) {
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setM(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/session/${sessionId}/metrics`);
        if (!res.ok) return;
        const data = (await res.json()) as Metrics;
        if (!cancelled) setM(data);
      } catch {
        /* transient — ignore */
      }
    };
    load();
    const t1 = setTimeout(load, 1500);
    const t2 = setTimeout(load, 3500);
    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [sessionId, refreshKey]);

  const scored = m?.turnsScored ?? 0;
  const hasData = !!sessionId && scored > 0;
  const index = hasData ? m!.independenceIndex : 0;

  return (
    <div className="rounded-2xl border border-black/10 bg-white/60 p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-black/40">
        Independence Index
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-4xl font-semibold tabular-nums">
          {hasData ? index : "—"}
        </span>
        <span className="text-sm text-black/40">/ 100</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/10">
        <div
          className="h-full rounded-full bg-ink transition-all duration-500"
          style={{ width: `${index}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] leading-snug text-black/40">
        How independently you worked this session — a behavioural signal, not a
        critical-thinking score.
      </p>

      <div className="mt-5 space-y-3">
        <Bar
          label="Verification rate"
          value={m?.verificationRate ?? 0}
          kind="ratio"
          tone="good"
          hint="checked or pushed on a claim"
        />
        <Bar
          label="Offload ratio"
          value={m?.offloadRatio ?? 0}
          kind="ratio"
          tone="warn"
          hint="asked the AI to produce the answer"
        />
        <Bar
          label="Cave rate"
          value={m?.caveRate ?? 0}
          kind="ratio"
          tone="warn"
          hint="dropped your view to agree"
        />
        <Bar
          label="Acceptance latency"
          value={m?.acceptanceLatency ?? 0}
          kind="latency"
          tone="neutral"
          hint="avg time before you replied"
        />
      </div>

      {typeof m?.soloScore === "number" && (
        <div className="mt-5 rounded-xl bg-black/[0.03] p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-black/40">
            Solo Score
          </div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums">
            {Math.round(m.soloScore * 100)}%
          </div>
          <p className="mt-1 text-[11px] leading-snug text-black/40">
            How you did on these items without help — not a measure of you.
          </p>
        </div>
      )}

      <div className="mt-4 text-[11px] text-black/30">
        {!sessionId
          ? "Your meters will appear once you start chatting."
          : scored === 0
            ? "Scoring your first turn…"
            : `Based on ${scored} scored turn${scored === 1 ? "" : "s"}.`}
      </div>
    </div>
  );
}
