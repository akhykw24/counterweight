"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = {
  session: number;
  id: string;
  startedAt: string;
  independenceIndex: number;
  turnsScored: number;
  soloScore: number | null;
  retentionScore: number | null;
};

type ChartPoint = Point & {
  retentionPct: number | null;
  soloPct: number | null;
};

export default function TrendsPage() {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/trends")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setPoints(d.points as Point[]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const data: ChartPoint[] = useMemo(
    () =>
      (points ?? []).map((p) => ({
        ...p,
        retentionPct:
          p.retentionScore === null ? null : Math.round(p.retentionScore * 100),
        soloPct: p.soloScore === null ? null : Math.round(p.soloScore * 100),
      })),
    [points]
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">
          Independence over time
        </h1>
        <Link
          href="/"
          className="text-sm text-black/50 underline-offset-4 hover:underline"
        >
          ← Back to chat
        </Link>
      </div>
      <p className="mt-1 text-sm text-black/50">
        Independence Index per session, and — where you took the re-checks —
        what stuck days later. Behavioural signals, not a critical-thinking
        score.
      </p>

      <div className="mt-8 h-80 rounded-2xl border border-black/10 bg-white/60 p-4">
        {error && <div className="text-sm text-red-600">{error}</div>}

        {!error && !points && (
          <div className="flex h-full items-center justify-center text-sm text-black/40">
            Loading…
          </div>
        )}

        {!error && points && points.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-black/40">
            No completed sessions yet. Have a chat, then check back.
          </div>
        )}

        {!error && points && points.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 10, right: 16, bottom: 8, left: -16 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
              <XAxis
                dataKey="session"
                tick={{ fontSize: 12, fill: "rgba(0,0,0,0.45)" }}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 12, fill: "rgba(0,0,0,0.45)" }}
              />
              <Tooltip
                formatter={(v: number, name: string, props) => {
                  if (name === "What stuck") {
                    const solo = (props.payload as ChartPoint).soloPct;
                    return [
                      `${v}%${solo !== null ? ` (solo right after: ${solo}%)` : ""}`,
                      name,
                    ];
                  }
                  return [`${v} / 100`, name];
                }}
                labelFormatter={(l) => `Session ${l}`}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.1)",
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                name="Independence Index"
                dataKey="independenceIndex"
                stroke="#1c1c1e"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                name="What stuck"
                dataKey="retentionPct"
                stroke="#d97706"
                strokeWidth={2}
                strokeDasharray="6 3"
                connectNulls
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="mt-3 text-xs text-black/30">
        &quot;What stuck&quot; is your score on the spaced re-checks (24h / 3
        days later) for sessions where you took them — retention on those items,
        nothing more.
      </p>
    </main>
  );
}
